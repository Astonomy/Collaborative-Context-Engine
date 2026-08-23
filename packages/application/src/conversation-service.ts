import type { Clock, IdGenerator } from "@cce/shared";
import {
  assertBranchTransition,
  auditEventIdSchema,
  branchIdSchema,
  branchSchema,
  conversationIdSchema,
  conversationSchema,
  messageIdSchema,
  messageSchema,
  type Conversation,
  type Message,
  type ProjectId,
  type UserId,
} from "@cce/domain";

import { authorizeProjectMember, requireActiveProject } from "./authorization";
import { ApplicationError } from "./errors";
import type { UnitOfWork } from "./repositories";

export class ConversationService {
  public constructor(
    private readonly unitOfWork: UnitOfWork,
    private readonly ids: IdGenerator,
    private readonly clock: Clock,
  ) {}

  public async create(input: {
    readonly projectId: ProjectId;
    readonly actorUserId: UserId;
    readonly title: string;
  }): Promise<Conversation> {
    const conversationId = conversationIdSchema.parse(this.ids.next());
    const branchId = branchIdSchema.parse(this.ids.next());
    const eventId = auditEventIdSchema.parse(this.ids.next());
    const now = this.clock.now().toISOString();

    return this.unitOfWork.run(async (repositories) => {
      const access = await repositories.projects.findAccess(input.projectId, input.actorUserId);
      authorizeProjectMember(access?.member ?? null, input.actorUserId, "conversation:write");
      if (access === null) {
        throw new ApplicationError("NOT_FOUND", "Project was not found.");
      }
      requireActiveProject(access.project);
      const conversation = conversationSchema.parse({
        id: conversationId,
        projectId: input.projectId,
        branchId,
        title: input.title,
        status: "active",
        createdBy: { type: "human", userId: input.actorUserId },
        createdAt: now,
        archivedAt: null,
      });
      const branch = branchSchema.parse({
        id: branchId,
        projectId: input.projectId,
        conversationId,
        baseCommitId: access.project.headCommitId,
        status: "open",
        createdAt: now,
        closedAt: null,
      });
      await repositories.conversations.insert(conversation, branch);
      await repositories.audit.append({
        id: eventId,
        projectId: input.projectId,
        actor: { type: "human", userId: input.actorUserId },
        action: "conversation.created",
        targetType: "conversation",
        targetId: conversationId,
        metadata: { baseCommitId: access.project.headCommitId, title: conversation.title },
        occurredAt: now,
      });
      return conversation;
    });
  }

  public async list(
    projectId: ProjectId,
    actorUserId: UserId,
  ): Promise<readonly Conversation[]> {
    return this.unitOfWork.run(async (repositories) => {
      const access = await repositories.projects.findAccess(projectId, actorUserId);
      authorizeProjectMember(access?.member ?? null, actorUserId, "project:read");
      return repositories.conversations.list(projectId);
    });
  }

  public async get(input: {
    readonly projectId: ProjectId;
    readonly conversationId: Conversation["id"];
    readonly actorUserId: UserId;
  }): Promise<Conversation> {
    return this.unitOfWork.run(async (repositories) => {
      const access = await repositories.projects.findAccess(input.projectId, input.actorUserId);
      authorizeProjectMember(access?.member ?? null, input.actorUserId, "project:read");
      const conversation = await repositories.conversations.find(
        input.projectId,
        input.conversationId,
      );
      if (conversation === null) {
        throw new ApplicationError("NOT_FOUND", "Conversation was not found.");
      }
      return conversation;
    });
  }

  public async update(input: {
    readonly projectId: ProjectId;
    readonly conversationId: Conversation["id"];
    readonly actorUserId: UserId;
    readonly title?: string;
    readonly archive?: true;
  }): Promise<Conversation> {
    if (input.title === undefined && input.archive !== true) {
      throw new ApplicationError(
        "VALIDATION",
        "A conversation update requires a title or archive action.",
      );
    }
    const now = this.clock.now().toISOString();
    const eventId = auditEventIdSchema.parse(this.ids.next());
    return this.unitOfWork.run(async (repositories) => {
      const access = await repositories.projects.findAccess(input.projectId, input.actorUserId);
      authorizeProjectMember(access?.member ?? null, input.actorUserId, "conversation:write");
      if (access === null) {
        throw new ApplicationError("NOT_FOUND", "Project was not found.");
      }
      requireActiveProject(access.project);
      const conversation = await repositories.conversations.lock(
        input.projectId,
        input.conversationId,
      );
      if (conversation === null) {
        throw new ApplicationError("NOT_FOUND", "Conversation was not found.");
      }
      if (
        conversation.status === "archived" &&
        input.title !== undefined &&
        input.title !== conversation.title
      ) {
        throw new ApplicationError("CONFLICT", "An archived conversation cannot be renamed.");
      }
      const branch = await repositories.conversations.findBranch(
        input.projectId,
        conversation.branchId,
      );
      if (branch === null || branch.conversationId !== conversation.id) {
        throw new ApplicationError("CONFLICT", "Conversation Branch is unavailable.");
      }
      const updatedConversation = conversationSchema.parse({
        ...conversation,
        title: input.title ?? conversation.title,
        status: input.archive === true ? "archived" : conversation.status,
        archivedAt:
          input.archive === true ? (conversation.archivedAt ?? now) : conversation.archivedAt,
      });
      const updatedBranch =
        input.archive === true && branch.status === "open"
          ? branchSchema.parse({ ...branch, status: "abandoned", closedAt: now })
          : branch;
      if (updatedBranch !== branch) {
        assertBranchTransition(branch.status, updatedBranch.status);
      }
      if (
        updatedConversation.title === conversation.title &&
        updatedConversation.status === conversation.status
      ) {
        return conversation;
      }
      await repositories.conversations.update(updatedConversation, updatedBranch);
      await repositories.audit.append({
        id: eventId,
        projectId: input.projectId,
        actor: { type: "human", userId: input.actorUserId },
        action: "conversation.updated",
        targetType: "conversation",
        targetId: conversation.id,
        metadata: {
          previousTitle: conversation.title,
          title: updatedConversation.title,
          archived: conversation.status === "active" && updatedConversation.status === "archived",
        },
        occurredAt: now,
      });
      return updatedConversation;
    });
  }

  public async listMessages(input: {
    readonly projectId: ProjectId;
    readonly conversationId: Conversation["id"];
    readonly actorUserId: UserId;
  }): Promise<readonly Message[]> {
    return this.unitOfWork.run(async (repositories) => {
      const access = await repositories.projects.findAccess(input.projectId, input.actorUserId);
      authorizeProjectMember(access?.member ?? null, input.actorUserId, "project:read");
      const conversation = await repositories.conversations.find(
        input.projectId,
        input.conversationId,
      );
      if (conversation === null) {
        throw new ApplicationError("NOT_FOUND", "Conversation was not found.");
      }
      return repositories.conversations.listMessages(input.projectId, input.conversationId);
    });
  }

  public async appendUserMessage(input: {
    readonly projectId: ProjectId;
    readonly conversationId: Conversation["id"];
    readonly actorUserId: UserId;
    readonly clientMessageId: string;
    readonly content: string;
  }): Promise<Message> {
    const messageId = messageIdSchema.parse(this.ids.next());
    const eventId = auditEventIdSchema.parse(this.ids.next());
    const now = this.clock.now().toISOString();

    return this.unitOfWork.run(async (repositories) => {
      const access = await repositories.projects.findAccess(input.projectId, input.actorUserId);
      authorizeProjectMember(access?.member ?? null, input.actorUserId, "conversation:write");
      if (access === null) {
        throw new ApplicationError("NOT_FOUND", "Project was not found.");
      }
      requireActiveProject(access.project);
      const conversation = await repositories.conversations.lock(
        input.projectId,
        input.conversationId,
      );
      if (conversation === null || conversation.status !== "active") {
        throw new ApplicationError("NOT_FOUND", "Active conversation was not found.");
      }
      // Sequence allocation locks the Conversation row in the PostgreSQL adapter.
      // Taking that lock before the idempotency lookup makes concurrent retries
      // observe the first committed message instead of racing the unique index.
      const sequence = await repositories.conversations.nextMessageSequence(
        input.projectId,
        input.conversationId,
      );
      const existing = await repositories.conversations.findMessageByClientId(
        input.projectId,
        input.conversationId,
        input.clientMessageId,
      );
      if (existing !== null) {
        if (
          existing.role !== "user" ||
          existing.content !== input.content ||
          existing.author.type !== "human" ||
          existing.author.userId !== input.actorUserId
        ) {
          throw new ApplicationError(
            "CONFLICT",
            "clientMessageId is already bound to a different user message.",
          );
        }
        return existing;
      }
      const message = messageSchema.parse({
        id: messageId,
        projectId: input.projectId,
        conversationId: input.conversationId,
        sequence,
        clientMessageId: input.clientMessageId,
        replyToMessageId: null,
        role: "user",
        deliveryState: "completed",
        content: input.content,
        author: { type: "human", userId: input.actorUserId },
        providerMessageId: null,
        errorCode: null,
        createdAt: now,
        completedAt: now,
      });
      await repositories.conversations.insertMessage(message);
      await repositories.audit.append({
        id: eventId,
        projectId: input.projectId,
        actor: { type: "human", userId: input.actorUserId },
        action: "message.created",
        targetType: "message",
        targetId: messageId,
        metadata: { conversationId: input.conversationId, sequence },
        occurredAt: now,
      });
      return message;
    });
  }
}
