import { importAttachmentSchema, type ImportAttachment } from "./import-attachment";
import {
  auditEventIdSchema,
  attachmentSchema,
  attachmentEventSchema,
  attachmentIdSchema,
  conversationIdSchema,
  projectIdSchema,
  userIdSchema,
  messageSchema,
  type Attachment,
  type AttachmentId,
  type ConversationId,
  type ProjectId,
  type UserId,
} from "@cce/domain";
import type { Clock, IdGenerator } from "@cce/shared";
import { z } from "zod";
import type { AttachmentRepository } from "./attachment-repository";
import type { CceRepositories } from "./repositories";
import type { AttachmentStorage, ByteRange } from "./attachment-storage";
import { authorizeProjectMember, requireActiveProject } from "./authorization";
import { ApplicationError } from "./errors";
import {
  attachmentByteRange,
  detectAttachmentMime,
  maximumAttachmentBytes,
  normalizeAttachmentFilename,
  validateDeclaredMime,
} from "./attachment-policy";

type Repositories = CceRepositories & { readonly attachments: AttachmentRepository };
export interface AttachmentUnitOfWork {
  runWithAttachments<T>(operation: (repositories: Repositories) => Promise<T>): Promise<T>;
}
const uploadSchema = z
  .object({
    projectId: projectIdSchema,
    conversationId: conversationIdSchema,
    actorUserId: userIdSchema,
    clientMessageId: z.uuid(),
    filename: z.string().max(1024),
    declaredMimeType: z.string().max(255),
  })
  .strict();
type UploadInput = z.infer<typeof uploadSchema>;

export class AttachmentService {
  public constructor(
    private readonly unitOfWork: AttachmentUnitOfWork,
    private readonly storage: AttachmentStorage,
    private readonly ids: IdGenerator,
    private readonly clock: Clock,
  ) {}

  public async upload(input: UploadInput, bytes: AsyncIterable<Uint8Array>): Promise<Attachment> {
    const parsed = uploadSchema.safeParse(input);
    if (!parsed.success)
      throw new ApplicationError("VALIDATION", "Invalid attachment upload metadata.");
    const filename = normalizeAttachmentFilename(parsed.data.filename);
    const declaredMimeType = validateDeclaredMime(parsed.data.declaredMimeType);
    await this.unitOfWork.runWithAttachments((repositories) =>
      this.authorizeUpload(repositories, input),
    );
    const { object, media, received } = await this.storeBytes(bytes, declaredMimeType);

    // No storage operation inside the DB transaction. A failed/ambiguous commit leaves an
    // inaccessible orphan: never delete an object that might already back committed evidence.
    return this.unitOfWork.runWithAttachments(async (repositories) => {
      // Serialize binding with project archive and membership changes.
      await repositories.projects.lockById(input.projectId);
      await this.authorizeUpload(repositories, input);
      const conversation = await repositories.conversations.lock(
        input.projectId,
        input.conversationId,
      );
      if (conversation === null || conversation.status !== "active")
        throw new ApplicationError("CONFLICT", "Conversation is not active.");
      const existing = await repositories.conversations.findMessageByClientId(
        input.projectId,
        input.conversationId,
        input.clientMessageId,
      );
      if (existing !== null) {
        const attached = await repositories.attachments.listForMessage(
          input.projectId,
          existing.id,
        );
        const previous = attached[0];
        if (
          existing.author.type !== "human" ||
          existing.author.userId !== input.actorUserId ||
          attached.length !== 1 ||
          previous === undefined ||
          previous.checksum.value !== object.checksum.value ||
          previous.byteSize !== received ||
          previous.originalFilename !== filename ||
          previous.declaredMimeType !== declaredMimeType
        ) {
          throw new ApplicationError(
            "CONFLICT",
            "clientMessageId is already bound to different evidence.",
          );
        }
        return previous;
      }
      const now = this.clock.now().toISOString();
      const sequence = await repositories.conversations.nextMessageSequence(
        input.projectId,
        input.conversationId,
      );
      const message = messageSchema.parse({
        id: this.ids.next(),
        projectId: input.projectId,
        conversationId: input.conversationId,
        sequence,
        clientMessageId: input.clientMessageId,
        role: "user",
        deliveryState: "completed",
        content: `Attachment: ${filename}`,
        author: { type: "human", userId: input.actorUserId },
        providerMessageId: null,
        errorCode: null,
        createdAt: now,
        completedAt: now,
      });
      const attachment = attachmentSchema.parse({
        id: this.ids.next(),
        projectId: input.projectId,
        conversationId: input.conversationId,
        messageId: message.id,
        ordinal: 0,
        originalFilename: filename,
        declaredMimeType,
        ...media,
        ...object,
        createdAt: now,
        createdBy: message.author,
      });
      await repositories.attachments.insert(attachment);
      await repositories.conversations.insertMessage(message);
      await repositories.attachments.appendEvent(
        attachmentEventSchema.parse({
          id: this.ids.next(),
          projectId: input.projectId,
          attachmentId: attachment.id,
          sequence: 1,
          processingStatus: "pending",
          availability: "available",
          reason: "Binary upload validated; no derived processing performed.",
          occurredAt: now,
          actor: message.author,
        }),
      );
      await repositories.audit.append({
        id: auditEventIdSchema.parse(this.ids.next()),
        projectId: input.projectId,
        actor: message.author,
        action: "message.created",
        targetType: "message",
        targetId: message.id,
        metadata: { conversationId: input.conversationId, sequence, attachmentId: attachment.id },
        occurredAt: now,
      });
      return attachment;
    });
  }

  private async storeBytes(
    bytes: AsyncIterable<Uint8Array>,
    declaredMimeType: string,
  ): Promise<{
    object: Awaited<ReturnType<AttachmentStorage["put"]>>;
    media: ReturnType<typeof detectAttachmentMime>;
    received: number;
  }> {
    let received = 0;
    let prefix = new Uint8Array(0);
    let media: ReturnType<typeof detectAttachmentMime> | undefined;
    async function* bounded(): AsyncIterable<Uint8Array> {
      for await (const chunk of bytes) {
        received += chunk.byteLength;
        if (received > maximumAttachmentBytes)
          throw new ApplicationError("VALIDATION", "Attachment exceeds the 100 MiB limit.");
        if (prefix.length < 512) {
          const next = new Uint8Array(Math.min(512, prefix.length + chunk.length));
          next.set(prefix);
          next.set(chunk.subarray(0, next.length - prefix.length), prefix.length);
          prefix = next;
        }
        yield chunk;
      }
      if (received === 0) throw new ApplicationError("VALIDATION", "Attachment is empty.");
      media = detectAttachmentMime(prefix, declaredMimeType);
    }
    let object: Awaited<ReturnType<AttachmentStorage["put"]>>;
    try {
      object = await this.storage.put(bounded());
    } catch (error) {
      throw storageError(error);
    }
    if (object.byteSize !== received || media === undefined) throw storageError(null);

    return { object, media, received };
  }

  public async uploadForImport(
    input: {
      projectId: ProjectId;
      actorUserId: UserId;
      uploadId: string;
      filename: string;
      declaredMimeType: string;
    },
    bytes: AsyncIterable<Uint8Array>,
  ): Promise<ImportAttachment> {
    const parsed = uploadSchema
      .omit({ conversationId: true, clientMessageId: true })
      .extend({ uploadId: z.uuid() })
      .safeParse(input);
    if (!parsed.success)
      throw new ApplicationError("VALIDATION", "Invalid import attachment metadata.");
    const filename = normalizeAttachmentFilename(input.filename);
    const declaredMimeType = validateDeclaredMime(input.declaredMimeType);
    const authorize = async (repositories: Repositories): Promise<void> => {
      const access = await repositories.projects.findAccess(input.projectId, input.actorUserId);
      authorizeProjectMember(access?.member ?? null, input.actorUserId, "conversation:import");
      if (!access) throw new ApplicationError("NOT_FOUND", "Project was not found.");
      requireActiveProject(access.project);
    };
    await this.unitOfWork.runWithAttachments(authorize);
    const { object, media, received } = await this.storeBytes(bytes, declaredMimeType);
    return this.unitOfWork.runWithAttachments(async (repositories) => {
      await repositories.projects.lockById(input.projectId);
      await authorize(repositories);
      const previous = await repositories.attachments.findImportUploadByRequest(
        input.projectId,
        input.actorUserId,
        input.uploadId,
      );
      if (previous) {
        if (
          previous.originalFilename !== filename ||
          previous.declaredMimeType !== declaredMimeType ||
          previous.checksum.value !== object.checksum.value ||
          previous.byteSize !== received
        )
          throw new ApplicationError(
            "CONFLICT",
            "uploadId is already bound to different bytes or metadata.",
          );
        return previous;
      }
      const now = this.clock.now();
      const upload = importAttachmentSchema.parse({
        id: this.ids.next(),
        projectId: input.projectId,
        actorUserId: input.actorUserId,
        uploadId: input.uploadId,
        originalFilename: filename,
        declaredMimeType,
        ...media,
        ...object,
        createdAt: now.toISOString(),
        expiresAt: new Date(now.getTime() + 24 * 60 * 60 * 1000).toISOString(),
      });
      await repositories.attachments.insertImportUpload(upload);
      return upload;
    });
  }

  private async authorizeUpload(
    repositories: Repositories,
    input: { projectId: ProjectId; actorUserId: UserId; conversationId: ConversationId },
  ): Promise<void> {
    const access = await repositories.projects.findAccess(input.projectId, input.actorUserId);
    authorizeProjectMember(access?.member ?? null, input.actorUserId, "conversation:write");
    if (access === null) throw new ApplicationError("NOT_FOUND", "Project was not found.");
    requireActiveProject(access.project);
    const conversation = await repositories.conversations.find(
      input.projectId,
      input.conversationId,
    );
    if (conversation === null)
      throw new ApplicationError("NOT_FOUND", "Conversation was not found.");
    if (conversation.status !== "active")
      throw new ApplicationError("CONFLICT", "Conversation is not active.");
  }

  public async list(input: {
    projectId: ProjectId;
    conversationId: ConversationId;
    actorUserId: UserId;
  }): Promise<readonly Attachment[]> {
    projectIdSchema.parse(input.projectId);
    conversationIdSchema.parse(input.conversationId);
    userIdSchema.parse(input.actorUserId);
    return this.unitOfWork.runWithAttachments(async (repositories) => {
      const access = await repositories.projects.findAccess(input.projectId, input.actorUserId);
      authorizeProjectMember(access?.member ?? null, input.actorUserId, "project:read");
      const conversation = await repositories.conversations.find(
        input.projectId,
        input.conversationId,
      );
      if (conversation === null)
        throw new ApplicationError("NOT_FOUND", "Conversation was not found.");
      return repositories.attachments.listForConversation(input.projectId, input.conversationId);
    });
  }

  public async get(input: {
    projectId: ProjectId;
    attachmentId: AttachmentId;
    actorUserId: UserId;
  }): Promise<Attachment> {
    projectIdSchema.parse(input.projectId);
    attachmentIdSchema.parse(input.attachmentId);
    userIdSchema.parse(input.actorUserId);
    return this.unitOfWork.runWithAttachments(async (repositories) => {
      const access = await repositories.projects.findAccess(input.projectId, input.actorUserId);
      authorizeProjectMember(access?.member ?? null, input.actorUserId, "project:read");
      const attachment = await repositories.attachments.find(input.projectId, input.attachmentId);
      if (attachment === null || attachment.projectId !== input.projectId)
        throw new ApplicationError("NOT_FOUND", "Attachment was not found.");
      const conversation = await repositories.conversations.find(
        input.projectId,
        attachment.conversationId,
      );
      if (conversation === null)
        throw new ApplicationError("NOT_FOUND", "Conversation was not found.");
      const events = await repositories.attachments.listEvents(input.projectId, input.attachmentId);
      const latest = events.reduce<(typeof events)[number] | undefined>(
        (a, b) => (!a || b.sequence > a.sequence ? b : a),
        undefined,
      );
      if (latest?.availability !== "available")
        throw new ApplicationError("CONFLICT", "Attachment is not available.");
      return attachment;
    });
  }

  public async download(input: {
    projectId: ProjectId;
    attachmentId: AttachmentId;
    actorUserId: UserId;
    range?: string;
  }): Promise<{
    attachment: Attachment;
    bytes: AsyncIterable<Uint8Array>;
    range: ByteRange | undefined;
  }> {
    const attachment = await this.get(input);
    const range = attachmentByteRange(input.range, attachment.byteSize);
    try {
      const source = await this.storage.open(attachment.storage, attachment.byteSize, range);
      const iterator = source[Symbol.asyncIterator]();
      const bytes: AsyncIterableIterator<Uint8Array> = {
        [Symbol.asyncIterator]() {
          return this;
        },
        async next() {
          try {
            return await iterator.next();
          } catch {
            throw storageError(null);
          }
        },
        async return() {
          try {
            await iterator.return?.();
          } catch {
            throw storageError(null);
          }
          return { done: true, value: undefined };
        },
      };
      return { attachment, bytes, range };
    } catch (error) {
      throw storageError(error);
    }
  }
}

function storageError(error: unknown): ApplicationError {
  return error instanceof ApplicationError
    ? error
    : new ApplicationError("DEPENDENCY_UNAVAILABLE", "Attachment storage is unavailable.");
}
