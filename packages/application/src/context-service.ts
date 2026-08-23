import type {
  ContextCommit,
  ContextItemVersion,
  ConversationId,
  ProjectId,
  UserId,
} from "@cce/domain";
import { buildContextPack, type ContextPack, type ContextSnapshot } from "@cce/context-engine";

import { authorizeProjectMember } from "./authorization";
import { ApplicationError } from "./errors";
import type { UnitOfWork } from "./repositories";

export class ContextService {
  public constructor(private readonly unitOfWork: UnitOfWork) {}

  public async listCurrentItems(input: {
    readonly projectId: ProjectId;
    readonly actorUserId: UserId;
  }): Promise<readonly ContextItemVersion[]> {
    return this.unitOfWork.run(async (repositories) => {
      const access = await repositories.projects.findAccess(input.projectId, input.actorUserId);
      authorizeProjectMember(access?.member ?? null, input.actorUserId, "project:read");
      return repositories.context.listCurrentItems(input.projectId);
    });
  }

  public async getHeadSnapshot(input: {
    readonly projectId: ProjectId;
    readonly actorUserId: UserId;
  }): Promise<ContextSnapshot> {
    return this.unitOfWork.run(async (repositories) => {
      const access = await repositories.projects.findAccess(input.projectId, input.actorUserId);
      authorizeProjectMember(access?.member ?? null, input.actorUserId, "project:read");
      const snapshot = await repositories.context.getHeadSnapshot(input.projectId);
      if (snapshot === null) {
        throw new ApplicationError("CONFLICT", "Project Context HEAD is unavailable.");
      }
      return snapshot;
    });
  }

  public async listCommits(input: {
    readonly projectId: ProjectId;
    readonly actorUserId: UserId;
  }): Promise<readonly ContextCommit[]> {
    return this.unitOfWork.run(async (repositories) => {
      const access = await repositories.projects.findAccess(input.projectId, input.actorUserId);
      authorizeProjectMember(access?.member ?? null, input.actorUserId, "project:read");
      return repositories.context.listCommits(input.projectId);
    });
  }

  public async buildForConversation(input: {
    readonly projectId: ProjectId;
    readonly conversationId: ConversationId;
    readonly actorUserId: UserId;
    readonly maxRecentMessages?: number;
    readonly recentMessageCharacterBudget?: number;
  }): Promise<ContextPack> {
    return this.unitOfWork.run(async (repositories) => {
      const access = await repositories.projects.findAccess(input.projectId, input.actorUserId);
      authorizeProjectMember(access?.member ?? null, input.actorUserId, "project:read");
      if (access === null) {
        throw new ApplicationError("NOT_FOUND", "Project was not found.");
      }
      const conversation = await repositories.conversations.find(
        input.projectId,
        input.conversationId,
      );
      if (conversation === null) {
        throw new ApplicationError("NOT_FOUND", "Conversation was not found.");
      }
      const [snapshot, messages] = await Promise.all([
        repositories.context.getHeadSnapshot(input.projectId),
        repositories.conversations.listMessages(input.projectId, input.conversationId),
      ]);
      if (snapshot === null) {
        throw new ApplicationError("CONFLICT", "Project Context HEAD is unavailable.");
      }
      return buildContextPack({
        project: {
          id: access.project.id,
          name: access.project.name,
          headCommitId: snapshot.commitId,
          version: snapshot.version,
        },
        items: snapshot.items,
        messages,
        maxRecentMessages: input.maxRecentMessages ?? 20,
        recentMessageCharacterBudget: input.recentMessageCharacterBudget ?? 20_000,
      });
    });
  }
}
