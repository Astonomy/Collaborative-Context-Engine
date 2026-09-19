import { createHash } from "node:crypto";
import {
  ChatGptExportImporter,
  ConversationImportError,
  normalizeProviderSubmission,
  selectCurrentPath,
  type ExternalConversation,
  type NormalizedProviderSubmission,
  type ProviderConversationSubmission,
} from "@cce/conversation-import";
import {
  auditEventIdSchema,
  branchIdSchema,
  branchSchema,
  conversationIdSchema,
  conversationSchema,
  messageIdSchema,
  messageSchema,
  type Conversation,
  type ContextCommitId,
  type ProjectId,
  type UserId,
} from "@cce/domain";
import type { Clock, IdGenerator } from "@cce/shared";
import { authorizeProjectMember, requireActiveProject } from "./authorization";
import { ApplicationError } from "./errors";
import type {
  CceRepositories,
  ConversationImportPreviewRecord,
  ConversationImportRecord,
  UnitOfWork,
} from "./repositories";

const providerPreviewLifetimeMs = 15 * 60 * 1_000;

export interface ImportPreview {
  readonly source: "chatgpt";
  readonly sourceFormat: "json";
  readonly sourceFileHash: string;
  readonly duplicateImportId?: string;
  readonly conversations: readonly {
    readonly selectionId: string;
    readonly title: string;
    readonly approximateDate?: string;
    readonly messageCount: number;
    readonly branchCount: number;
    readonly warnings: readonly string[];
  }[];
}

export interface ProviderImportPreview {
  readonly id: string;
  readonly source: "chatgpt-plugin" | "codex-plugin";
  readonly targetProject: { readonly id: ProjectId; readonly name: string };
  readonly operation: "create" | "append";
  readonly targetConversationId?: string;
  readonly title: string;
  readonly summary?: string;
  readonly messageCount: number;
  readonly unsupportedContentCount: number;
  readonly warnings: readonly string[];
  readonly duplicateStatus: "none" | "duplicate";
  readonly duplicateImportId?: string;
  readonly duplicateConversationId?: string;
  readonly expiresAt: string;
}

export class ConversationImportService {
  public constructor(
    private readonly unitOfWork: UnitOfWork,
    private readonly ids: IdGenerator,
    private readonly clock: Clock,
    private readonly importer = new ChatGptExportImporter(),
  ) {}

  public async preview(input: {
    projectId: ProjectId;
    actorUserId: UserId;
    fileName: string;
    bytes: Uint8Array;
  }): Promise<ImportPreview> {
    await this.authorize(input.projectId, input.actorUserId);
    const conversations = await this.parse(input.fileName, input.bytes);
    const detection = await this.importer.detect({ fileName: input.fileName, bytes: input.bytes });
    const hash = this.hash(input.bytes);
    const duplicate = await this.unitOfWork.run((repositories) =>
      repositories.imports.findCompletedByIdentity(input.projectId, hash, "current_path"),
    );
    return {
      source: "chatgpt",
      sourceFormat: this.format(detection.format),
      sourceFileHash: hash,
      ...(duplicate ? { duplicateImportId: duplicate.id } : {}),
      conversations: conversations.map((conversation, index) => ({
        selectionId: this.selectionId(conversation, index),
        title: conversation.title ?? "Untitled imported conversation",
        ...(conversation.createdAt ? { approximateDate: conversation.createdAt } : {}),
        messageCount: selectCurrentPath(conversation).filter(
          (node) => this.text(node).length > 0 && node.role !== "unknown",
        ).length,
        branchCount: Number(conversation.metadata["branchPointCount"] ?? 0),
        warnings: conversation.warnings,
      })),
    };
  }

  public async confirm(input: {
    projectId: ProjectId;
    actorUserId: UserId;
    fileName: string;
    bytes: Uint8Array;
    selectedConversationIds: readonly string[];
  }): Promise<ConversationImportRecord> {
    await this.authorize(input.projectId, input.actorUserId);
    const conversations = await this.parse(input.fileName, input.bytes);
    const hash = this.hash(input.bytes);
    const selected = new Set(input.selectedConversationIds);
    if (selected.size === 0) {
      throw new ApplicationError("VALIDATION", "Select at least one conversation.");
    }
    const chosen = conversations.filter((conversation, index) =>
      selected.has(this.selectionId(conversation, index)),
    );
    if (chosen.length !== selected.size) {
      throw new ApplicationError("VALIDATION", "Import selection does not match this source file.");
    }
    const detection = await this.importer.detect({
      fileName: input.fileName,
      bytes: input.bytes,
    });
    return this.persist({
      projectId: input.projectId,
      actorUserId: input.actorUserId,
      source: "chatgpt",
      sourceFormat: this.format(detection.format),
      sourceFileHash: hash,
      policy: "current_path",
      conversations: chosen,
    });
  }

  public async previewProviderSubmission(input: {
    projectId: ProjectId;
    actorUserId: UserId;
    submission: ProviderConversationSubmission;
  }): Promise<ProviderImportPreview> {
    await this.authorize(input.projectId, input.actorUserId);
    const normalized = this.normalize(input.submission);
    const source = normalized.conversation.source;
    if (source !== "chatgpt-plugin" && source !== "codex-plugin") {
      throw new ApplicationError("VALIDATION", "Provider submission source is invalid.");
    }
    const now = this.clock.now();
    const preview: ConversationImportPreviewRecord = {
      id: this.ids.next(),
      projectId: input.projectId,
      source,
      sourceFileHash: this.hashText(`${source}\n${normalized.normalizedJson}`),
      createdBy: input.actorUserId,
      createdAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + providerPreviewLifetimeMs).toISOString(),
      messageCount: normalized.messageCount,
      unsupportedContentCount: normalized.unsupportedContentCount,
      warnings: normalized.warnings,
      conversation: normalized.conversation,
    };
    const result = await this.unitOfWork.run(async (repositories) => {
      const access = await repositories.projects.findAccess(input.projectId, input.actorUserId);
      authorizeProjectMember(access?.member ?? null, input.actorUserId, "conversation:import");
      if (access === null) throw new ApplicationError("NOT_FOUND", "Project was not found.");
      requireActiveProject(access.project);
      const duplicate = await repositories.imports.findCompletedByIdentity(
        input.projectId,
        preview.sourceFileHash,
        "provided_messages",
      );
      const target = await this.resolveContinuation(
        repositories,
        input.projectId,
        input.actorUserId,
        preview.conversation,
        duplicate?.id,
      );
      await repositories.imports.deleteExpiredPreviews(input.projectId, now.toISOString());
      await repositories.imports.insertPreview(preview);
      return { access, duplicate, target };
    });
    return this.providerPreview(
      preview,
      result.access.project.name,
      result.duplicate,
      result.target?.conversation,
    );
  }

  public async submitProviderPreview(input: {
    projectId: ProjectId;
    actorUserId: UserId;
    previewId: string;
  }): Promise<ConversationImportRecord> {
    const preview = await this.unitOfWork.run(async (repositories) => {
      const access = await repositories.projects.findAccess(input.projectId, input.actorUserId);
      authorizeProjectMember(access?.member ?? null, input.actorUserId, "conversation:import");
      const value = await repositories.imports.findPreviewById(input.projectId, input.previewId);
      if (value === null || value.createdBy !== input.actorUserId) {
        throw new ApplicationError("NOT_FOUND", "Conversation import preview was not found.");
      }
      return value;
    });
    return this.persist({
      projectId: input.projectId,
      actorUserId: input.actorUserId,
      source: preview.source,
      sourceFormat: "mcp",
      sourceFileHash: preview.sourceFileHash,
      policy: "provided_messages",
      conversations: [preview.conversation],
      previewId: preview.id,
      previewExpiresAt: preview.expiresAt,
    });
  }

  public async get(
    projectId: ProjectId,
    actorUserId: UserId,
    importId: string,
  ): Promise<ConversationImportRecord> {
    await this.authorize(projectId, actorUserId, "project:read");
    const value = await this.unitOfWork.run((repositories) =>
      repositories.imports.findById(projectId, importId),
    );
    if (!value) throw new ApplicationError("NOT_FOUND", "Conversation import was not found.");
    return value;
  }

  private async persist(input: {
    projectId: ProjectId;
    actorUserId: UserId;
    source: ConversationImportRecord["source"];
    sourceFormat: "json" | "mcp";
    sourceFileHash: string;
    policy: ConversationImportRecord["policy"];
    conversations: readonly ExternalConversation[];
    previewId?: string;
    previewExpiresAt?: string;
  }): Promise<ConversationImportRecord> {
    return this.unitOfWork.run(async (repositories) => {
      const access = await repositories.projects.findAccess(input.projectId, input.actorUserId);
      authorizeProjectMember(access?.member ?? null, input.actorUserId, "conversation:import");
      if (access === null) throw new ApplicationError("NOT_FOUND", "Project was not found.");
      requireActiveProject(access.project);
      const lockedProject = await repositories.projects.lockById(input.projectId);
      if (lockedProject === null) throw new ApplicationError("NOT_FOUND", "Project was not found.");
      if (
        input.previewExpiresAt !== undefined &&
        Date.parse(input.previewExpiresAt) <= this.clock.now().getTime()
      ) {
        throw new ApplicationError("CONFLICT", "Conversation import preview has expired.");
      }
      const duplicate = await repositories.imports.findCompletedByIdentity(
        input.projectId,
        input.sourceFileHash,
        input.policy,
      );
      if (duplicate) return duplicate;

      const importId = this.ids.next();
      const eventId = auditEventIdSchema.parse(this.ids.next());
      const now = this.clock.now().toISOString();
      const sourceManifest = input.conversations.map((conversation) => ({
        ...conversation,
        metadata: {
          ...conversation.metadata,
          importId,
          importedBy: input.actorUserId,
          submittedAt: now,
          ...(input.previewId ? { previewId: input.previewId } : {}),
        },
      }));
      const importedConversations = [];
      let messageCount = 0;
      for (const [index, external] of sourceManifest.entries()) {
        const target =
          input.policy === "provided_messages"
            ? await this.resolveContinuation(
                repositories,
                input.projectId,
                input.actorUserId,
                external,
              )
            : null;
        const imported = await this.persistConversation(
          repositories,
          input.projectId,
          input.actorUserId,
          lockedProject.headCommitId,
          external,
          index,
          now,
          target,
        );
        importedConversations.push(imported);
        messageCount += imported.messageIds.length;
      }
      const warnings = sourceManifest.flatMap((conversation) => conversation.warnings);
      const record: ConversationImportRecord = {
        id: importId,
        projectId: input.projectId,
        source: input.source,
        sourceFormat: input.sourceFormat,
        sourceFileHash: input.sourceFileHash,
        policy: input.policy,
        status: "completed",
        createdBy: input.actorUserId,
        createdAt: now,
        completedAt: now,
        conversationCount: importedConversations.length,
        messageCount,
        warnings,
        sourceManifest,
        importedConversations,
      };
      await repositories.imports.insert(record);
      await repositories.audit.append({
        id: eventId,
        projectId: input.projectId,
        actor: { type: "human", userId: input.actorUserId },
        action: "conversation_import.completed",
        targetType: "conversation_import",
        targetId: importId,
        metadata: {
          source: input.source,
          sourceFileHash: input.sourceFileHash,
          conversationCount: importedConversations.length,
          messageCount,
          ...(input.conversations[0]?.previousImportId
            ? { previousImportId: input.conversations[0].previousImportId }
            : {}),
        },
        occurredAt: now,
      });
      return record;
    });
  }

  private async resolveContinuation(
    repositories: CceRepositories,
    projectId: ProjectId,
    actorUserId: UserId,
    external: ExternalConversation,
    duplicateImportId?: string,
  ): Promise<{ conversation: Conversation; externalConversationId?: string } | null> {
    if (external.previousImportId === undefined) return null;
    const previous = await repositories.imports.findById(projectId, external.previousImportId);
    if (previous === null || previous.createdBy !== actorUserId) {
      throw new ApplicationError("NOT_FOUND", "Previous conversation import was not found.");
    }
    const imported = previous.importedConversations[0];
    if (
      previous.source !== external.source ||
      previous.policy !== "provided_messages" ||
      previous.importedConversations.length !== 1 ||
      imported === undefined
    ) {
      throw new ApplicationError(
        "CONFLICT",
        "Previous import is not a matching provider submission.",
      );
    }
    if (
      imported.externalConversationId !== undefined &&
      external.externalConversationId !== undefined &&
      imported.externalConversationId !== external.externalConversationId
    ) {
      throw new ApplicationError(
        "CONFLICT",
        "The provider conversation does not match the previous import.",
      );
    }
    const conversation = await repositories.conversations.find(projectId, imported.conversationId);
    if (conversation === null || conversation.status !== "active") {
      throw new ApplicationError("CONFLICT", "The target conversation is no longer active.");
    }
    const successor = await repositories.imports.findContinuation(projectId, previous.id);
    if (successor !== null && successor.id !== duplicateImportId) {
      throw new ApplicationError(
        "CONFLICT",
        "This import already has a delta. Use the latest successful importId.",
      );
    }
    return {
      conversation,
      ...(imported.externalConversationId
        ? { externalConversationId: imported.externalConversationId }
        : {}),
    };
  }

  private async persistConversation(
    repositories: CceRepositories,
    projectId: ProjectId,
    actorUserId: UserId,
    baseCommitId: ContextCommitId,
    external: ExternalConversation,
    index: number,
    now: string,
    target: { conversation: Conversation; externalConversationId?: string } | null,
  ): Promise<ConversationImportRecord["importedConversations"][number]> {
    const conversationId = target?.conversation.id ?? conversationIdSchema.parse(this.ids.next());
    if (target === null) {
      const branchId = branchIdSchema.parse(this.ids.next());
      await repositories.conversations.insert(
        conversationSchema.parse({
          id: conversationId,
          projectId,
          branchId,
          title: external.title ?? `Imported conversation ${index + 1}`,
          status: "active",
          createdBy: { type: "human", userId: actorUserId },
          createdAt: external.createdAt ?? now,
          archivedAt: null,
        }),
        branchSchema.parse({
          id: branchId,
          projectId,
          conversationId,
          baseCommitId,
          status: "open",
          createdAt: now,
          closedAt: null,
        }),
      );
    } else {
      const locked = await repositories.conversations.lock(projectId, conversationId);
      if (locked === null || locked.status !== "active") {
        throw new ApplicationError("CONFLICT", "The target conversation is no longer active.");
      }
    }
    const firstSequence = await repositories.conversations.nextMessageSequence(
      projectId,
      conversationId,
    );
    const messageIds: string[] = [];
    const evidenceNodes =
      external.source === "chatgpt" ? selectCurrentPath(external) : external.nodes;
    for (const node of evidenceNodes) {
      const content = this.text(node);
      if (node.role === "unknown" || content.length === 0) continue;
      const id = messageIdSchema.parse(this.ids.next());
      await repositories.conversations.insertMessage(
        messageSchema.parse({
          id,
          projectId,
          conversationId,
          sequence: firstSequence + messageIds.length,
          clientMessageId: node.role === "user" ? this.ids.next() : null,
          replyToMessageId: null,
          role: node.role,
          deliveryState: "completed",
          content,
          author: {
            type: "policy",
            policyId: `${external.source}-conversation-import`,
            version: "1",
          },
          providerMessageId: node.externalMessageId ?? null,
          errorCode: null,
          createdAt: node.createdAt ?? now,
          completedAt: node.createdAt ?? now,
        }),
      );
      messageIds.push(id);
    }
    const externalConversationId =
      external.externalConversationId ?? target?.externalConversationId;
    return {
      ...(externalConversationId ? { externalConversationId } : {}),
      conversationId,
      messageIds,
    };
  }

  private providerPreview(
    preview: ConversationImportPreviewRecord,
    projectName: string,
    duplicate: ConversationImportRecord | null,
    target?: Conversation,
  ): ProviderImportPreview {
    const duplicateConversationId = duplicate?.importedConversations[0]?.conversationId;
    return {
      id: preview.id,
      source: preview.source,
      targetProject: { id: preview.projectId, name: projectName },
      operation: preview.conversation.previousImportId ? "append" : "create",
      ...(target ? { targetConversationId: target.id } : {}),
      title: target?.title ?? preview.conversation.title ?? "Untitled submitted conversation",
      ...(preview.conversation.summary ? { summary: preview.conversation.summary } : {}),
      messageCount: preview.messageCount,
      unsupportedContentCount: preview.unsupportedContentCount,
      warnings: preview.warnings,
      duplicateStatus: duplicate ? "duplicate" : "none",
      ...(duplicate ? { duplicateImportId: duplicate.id } : {}),
      ...(duplicateConversationId ? { duplicateConversationId } : {}),
      expiresAt: preview.expiresAt,
    };
  }

  private async authorize(
    projectId: ProjectId,
    userId: UserId,
    permission: "conversation:import" | "project:read" = "conversation:import",
  ): Promise<void> {
    await this.unitOfWork.run(async (repositories) => {
      const access = await repositories.projects.findAccess(projectId, userId);
      authorizeProjectMember(access?.member ?? null, userId, permission);
    });
  }

  private async parse(fileName: string, bytes: Uint8Array): Promise<ExternalConversation[]> {
    try {
      return await this.importer.parse({ fileName, bytes });
    } catch (error: unknown) {
      this.rethrowImportError(error);
    }
  }

  private normalize(submission: ProviderConversationSubmission): NormalizedProviderSubmission {
    try {
      return normalizeProviderSubmission(submission);
    } catch (error: unknown) {
      this.rethrowImportError(error);
    }
  }

  private rethrowImportError(error: unknown): never {
    if (error instanceof ConversationImportError) {
      throw new ApplicationError("VALIDATION", error.message, { importCode: error.code });
    }
    throw error;
  }

  private hash(bytes: Uint8Array): string {
    return createHash("sha256").update(bytes).digest("hex");
  }

  private hashText(value: string): string {
    return createHash("sha256").update(value, "utf8").digest("hex");
  }

  private selectionId(conversation: ExternalConversation, index: number): string {
    return conversation.externalConversationId ?? `index:${index}`;
  }

  private text(node: ExternalConversation["nodes"][number]): string {
    return node.content
      .filter((block): block is Extract<typeof block, { type: "text" }> => block.type === "text")
      .map((block) => block.text)
      .join("\n")
      .trim();
  }

  private format(value: "json" | undefined): "json" {
    if (value === undefined) {
      throw new ApplicationError("VALIDATION", "Import format was not detected.");
    }
    return value;
  }
}
