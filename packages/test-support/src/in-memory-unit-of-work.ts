import type {
  AuditEvent,
  Branch,
  ContextCommit,
  ContextDelta,
  ContextItemVersion,
  Conversation,
  MergeConflict,
  MergeFinalization,
  MergeRequest,
  Message,
  ModelRun,
  AgentRun,
  Project,
  ProjectMember,
  User,
  UserId,
} from "@cce/domain";
import type { ContextSnapshot } from "@cce/context-engine";
import type { CceRepositories, ProjectAccess, UnitOfWork } from "@cce/application";

export interface MemoryState {
  users: User[];
  tokenHashes: Map<string, UserId>;
  projects: Project[];
  members: ProjectMember[];
  conversations: Conversation[];
  branches: Branch[];
  messages: Message[];
  deltas: ContextDelta[];
  commits: ContextCommit[];
  projection: Map<string, ContextItemVersion>;
  mergeRequests: MergeRequest[];
  mergeConflicts: MergeConflict[];
  mergeFinalizations: MergeFinalization[];
  modelRuns: ModelRun[];
  agentRuns: AgentRun[];
  auditEvents: AuditEvent[];
}

function initialState(): MemoryState {
  return {
    users: [],
    tokenHashes: new Map(),
    projects: [],
    members: [],
    conversations: [],
    branches: [],
    messages: [],
    deltas: [],
    commits: [],
    projection: new Map(),
    mergeRequests: [],
    mergeConflicts: [],
    mergeFinalizations: [],
    modelRuns: [],
    agentRuns: [],
    auditEvents: [],
  };
}

function projectKey(projectId: string, id: string): string {
  return `${projectId}:${id}`;
}

export class InMemoryUnitOfWork implements UnitOfWork {
  private state = initialState();

  public readonly repositories: CceRepositories = {
    identity: {
      findUserById: async (userId) => this.state.users.find((user) => user.id === userId) ?? null,
      findUserByEmail: async (email) =>
        this.state.users.find((user) => user.email.toLowerCase() === email.toLowerCase()) ?? null,
      findUserByApiTokenHash: async (tokenHash) => {
        const userId = this.state.tokenHashes.get(tokenHash);
        return userId === undefined
          ? null
          : (this.state.users.find((user) => user.id === userId) ?? null);
      },
      insertUser: async (user) => {
        if (this.state.users.some((entry) => entry.id === user.id || entry.email === user.email)) {
          throw new Error("User already exists.");
        }
        this.state.users.push(user);
      },
      insertApiToken: async (input) => {
        if (!this.state.users.some((user) => user.id === input.userId)) {
          throw new Error("Token user does not exist.");
        }
        this.state.tokenHashes.set(input.tokenHash, input.userId);
      },
    },
    projects: {
      listForUser: async (userId) =>
        this.state.members
          .filter((member) => member.userId === userId)
          .map((member): ProjectAccess | null => {
            const project = this.state.projects.find((entry) => entry.id === member.projectId);
            return project === undefined ? null : { project, member };
          })
          .filter((access) => access !== null),
      findAccess: async (projectId, userId) => {
        const project = this.state.projects.find((entry) => entry.id === projectId);
        const member = this.state.members.find(
          (entry) => entry.projectId === projectId && entry.userId === userId,
        );
        return project === undefined || member === undefined ? null : { project, member };
      },
      findById: async (projectId) =>
        this.state.projects.find((project) => project.id === projectId) ?? null,
      lockById: async (projectId) =>
        this.state.projects.find((project) => project.id === projectId) ?? null,
      insert: async (project) => {
        if (this.state.projects.some((entry) => entry.id === project.id)) {
          throw new Error("Project already exists.");
        }
        this.state.projects.push(project);
      },
      updateDetails: async (project) => {
        const index = this.state.projects.findIndex((entry) => entry.id === project.id);
        const current = this.state.projects[index];
        if (current === undefined) {
          throw new Error("Project does not exist.");
        }
        if (
          current.headCommitId !== project.headCommitId ||
          current.version !== project.version ||
          current.createdBy !== project.createdBy ||
          current.createdAt !== project.createdAt
        ) {
          throw new Error("Project semantic identity cannot be changed by a details update.");
        }
        this.state.projects[index] = project;
      },
      advanceHead: async (projectId, expectedHeadCommitId, nextHeadCommitId, nextVersion) => {
        const index = this.state.projects.findIndex((project) => project.id === projectId);
        const project = this.state.projects[index];
        if (project === undefined || project.headCommitId !== expectedHeadCommitId) {
          return false;
        }
        this.state.projects[index] = {
          ...project,
          headCommitId: nextHeadCommitId,
          version: nextVersion,
        };
        return true;
      },
      listMembers: async (projectId) =>
        this.state.members.filter((member) => member.projectId === projectId),
      insertMember: async (member) => {
        if (
          this.state.members.some(
            (entry) => entry.projectId === member.projectId && entry.userId === member.userId,
          )
        ) {
          throw new Error("Project member already exists.");
        }
        this.state.members.push(member);
      },
      updateMemberRole: async (member) => {
        const index = this.state.members.findIndex(
          (entry) => entry.projectId === member.projectId && entry.userId === member.userId,
        );
        if (index < 0) {
          throw new Error("Project member does not exist.");
        }
        this.state.members[index] = member;
      },
    },
    conversations: {
      list: async (projectId) =>
        this.state.conversations.filter((conversation) => conversation.projectId === projectId),
      find: async (projectId, conversationId) =>
        this.state.conversations.find(
          (conversation) =>
            conversation.projectId === projectId && conversation.id === conversationId,
        ) ?? null,
      lock: async (projectId, conversationId) =>
        this.state.conversations.find(
          (conversation) =>
            conversation.projectId === projectId && conversation.id === conversationId,
        ) ?? null,
      findBranch: async (projectId, branchId) =>
        this.state.branches.find(
          (branch) => branch.projectId === projectId && branch.id === branchId,
        ) ?? null,
      insert: async (conversation, branch) => {
        if (
          conversation.projectId !== branch.projectId ||
          conversation.id !== branch.conversationId ||
          conversation.branchId !== branch.id
        ) {
          throw new Error("Conversation and Branch scope must match.");
        }
        this.state.conversations.push(conversation);
        this.state.branches.push(branch);
      },
      update: async (conversation, branch) => {
        const conversationIndex = this.state.conversations.findIndex(
          (entry) =>
            entry.projectId === conversation.projectId && entry.id === conversation.id,
        );
        const branchIndex = this.state.branches.findIndex(
          (entry) => entry.projectId === branch.projectId && entry.id === branch.id,
        );
        const currentConversation = this.state.conversations[conversationIndex];
        const currentBranch = this.state.branches[branchIndex];
        if (currentConversation === undefined || currentBranch === undefined) {
          throw new Error("Conversation or Branch does not exist.");
        }
        if (
          conversation.projectId !== branch.projectId ||
          conversation.id !== branch.conversationId ||
          conversation.branchId !== branch.id ||
          currentConversation.branchId !== conversation.branchId ||
          currentConversation.createdAt !== conversation.createdAt ||
          JSON.stringify(currentConversation.createdBy) !== JSON.stringify(conversation.createdBy) ||
          currentBranch.conversationId !== branch.conversationId ||
          currentBranch.baseCommitId !== branch.baseCommitId ||
          currentBranch.createdAt !== branch.createdAt
        ) {
          throw new Error("Conversation and Branch identity cannot be changed.");
        }
        this.state.conversations[conversationIndex] = conversation;
        this.state.branches[branchIndex] = branch;
      },
      listMessages: async (projectId, conversationId) =>
        this.state.messages
          .filter(
            (message) =>
              message.projectId === projectId && message.conversationId === conversationId,
          )
          .sort((left, right) => left.sequence - right.sequence),
      findMessageByClientId: async (projectId, conversationId, clientMessageId) =>
        this.state.messages.find(
          (message) =>
            message.projectId === projectId &&
            message.conversationId === conversationId &&
            message.clientMessageId === clientMessageId,
        ) ?? null,
      findAssistantReply: async (projectId, conversationId, userMessageId) =>
        this.state.messages.find(
          (message) =>
            message.projectId === projectId &&
            message.conversationId === conversationId &&
            message.role === "assistant" &&
            message.replyToMessageId === userMessageId,
        ) ?? null,
      nextMessageSequence: async (projectId, conversationId) => {
        const sequences = this.state.messages
          .filter(
            (message) =>
              message.projectId === projectId && message.conversationId === conversationId,
          )
          .map((message) => message.sequence);
        return sequences.length === 0 ? 1 : Math.max(...sequences) + 1;
      },
      insertMessage: async (message) => {
        if (
          this.state.messages.some(
            (entry) =>
              entry.projectId === message.projectId &&
              entry.conversationId === message.conversationId &&
              (entry.sequence === message.sequence ||
                (message.clientMessageId !== null &&
                  entry.clientMessageId === message.clientMessageId) ||
                (message.replyToMessageId !== null &&
                  entry.replyToMessageId === message.replyToMessageId)),
          )
        ) {
          throw new Error("Message sequence or client ID already exists.");
        }
        this.state.messages.push(message);
      },
      updateStreamingMessage: async (message) => {
        const index = this.state.messages.findIndex(
          (entry) =>
            entry.projectId === message.projectId &&
            entry.conversationId === message.conversationId &&
            entry.id === message.id,
        );
        const current = this.state.messages[index];
        if (current === undefined || current.deliveryState !== "streaming") {
          throw new Error("Only a streaming message can be completed.");
        }
        this.state.messages[index] = message;
      },
    },
    context: {
      findDelta: async (projectId, deltaId) =>
        this.state.deltas.find((delta) => delta.projectId === projectId && delta.id === deltaId) ??
        null,
      insertDelta: async (delta) => {
        if (this.state.deltas.some((entry) => entry.id === delta.id)) {
          throw new Error("ContextDelta already exists.");
        }
        this.state.deltas.push(delta);
      },
      getSnapshot: async (projectId, commitId) => this.buildSnapshot(projectId, commitId),
      getHeadSnapshot: async (projectId) => {
        const project = this.state.projects.find((entry) => entry.id === projectId);
        return project === undefined ? null : this.buildSnapshot(projectId, project.headCommitId);
      },
      listCurrentItems: async (projectId) =>
        [...this.state.projection.entries()]
          .filter(([key]) => key.startsWith(`${projectId}:`))
          .map(([, value]) => value),
      listCommits: async (projectId) =>
        this.state.commits
          .filter((commit) => commit.projectId === projectId)
          .sort((left, right) => left.version - right.version),
      findCommitByIdempotencyKey: async (projectId, idempotencyKey) =>
        this.state.commits.find(
          (commit) => commit.projectId === projectId && commit.idempotencyKey === idempotencyKey,
        ) ?? null,
      insertCommit: async (commit) => {
        if (
          this.state.commits.some(
            (entry) =>
              entry.id === commit.id ||
              (entry.projectId === commit.projectId &&
                (entry.version === commit.version ||
                  entry.idempotencyKey === commit.idempotencyKey)) ||
              entry.sourceDeltaIds.some((deltaId) => commit.sourceDeltaIds.includes(deltaId)),
          )
        ) {
          throw new Error("ContextCommit uniqueness violation.");
        }
        this.state.commits.push(commit);
      },
      applyProjectionChanges: async (projectId, changes) => {
        for (const change of changes) {
          this.state.projection.set(
            projectKey(projectId, change.logicalItemId),
            change.afterVersion,
          );
        }
      },
    },
    merges: {
      list: async (projectId) =>
        this.state.mergeRequests.filter((request) => request.projectId === projectId),
      find: async (projectId, mergeRequestId) =>
        this.state.mergeRequests.find(
          (request) => request.projectId === projectId && request.id === mergeRequestId,
        ) ?? null,
      listConflicts: async (projectId, mergeRequestId) =>
        this.state.mergeConflicts.filter(
          (conflict) =>
            conflict.projectId === projectId && conflict.mergeRequestId === mergeRequestId,
        ),
      insert: async (request, conflicts) => {
        this.state.mergeRequests.push(request);
        this.state.mergeConflicts.push(...conflicts);
      },
      findFinalization: async (projectId, mergeRequestId) =>
        this.state.mergeFinalizations.find(
          (finalization) =>
            finalization.projectId === projectId && finalization.mergeRequestId === mergeRequestId,
        ) ?? null,
      insertFinalization: async (finalization) => {
        if (
          this.state.mergeFinalizations.some(
            (entry) =>
              (entry.projectId === finalization.projectId &&
                entry.mergeRequestId === finalization.mergeRequestId) ||
              (entry.projectId === finalization.projectId &&
                entry.operationKey === finalization.operationKey),
          )
        ) {
          throw new Error("Merge finalization already exists.");
        }
        this.state.mergeFinalizations.push(finalization);
      },
      saveResolution: async (projectId, conflictId, resolution) => {
        const index = this.state.mergeConflicts.findIndex(
          (conflict) => conflict.projectId === projectId && conflict.id === conflictId,
        );
        const conflict = this.state.mergeConflicts[index];
        if (conflict === undefined) {
          throw new Error("Merge conflict does not exist.");
        }
        this.state.mergeConflicts[index] = { ...conflict, resolution };
      },
      updateRequest: async (request) => {
        const index = this.state.mergeRequests.findIndex(
          (entry) => entry.projectId === request.projectId && entry.id === request.id,
        );
        if (index < 0) {
          throw new Error("MergeRequest does not exist.");
        }
        this.state.mergeRequests[index] = request;
      },
    },
    runs: {
      insertModelRun: async (run) => {
        this.state.modelRuns.push(run);
      },
      updateModelRun: async (run) => {
        const index = this.state.modelRuns.findIndex((entry) => entry.id === run.id);
        if (index < 0) {
          throw new Error("ModelRun does not exist.");
        }
        if (this.state.modelRuns[index]?.status !== "running" || run.status === "running") {
          throw new Error("ModelRun is not in a valid terminal transition.");
        }
        this.state.modelRuns[index] = run;
      },
      findModelRun: async (projectId, runId) =>
        this.state.modelRuns.find(
          (run) => run.projectId === projectId && run.id === runId,
        ) ?? null,
      listModelRuns: async (projectId) =>
        this.state.modelRuns
          .filter((run) => run.projectId === projectId)
          .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
          .slice(0, 200),
      insertAgentRun: async (run) => {
        this.state.agentRuns.push(run);
      },
      updateAgentRun: async (run, expectedVersion) => {
        const index = this.state.agentRuns.findIndex(
          (entry) =>
            entry.projectId === run.projectId &&
            entry.id === run.id &&
            entry.version === expectedVersion,
        );
        if (index < 0) return false;
        this.state.agentRuns[index] = run;
        return true;
      },
      findAgentRun: async (projectId, runId) =>
        this.state.agentRuns.find((run) => run.projectId === projectId && run.id === runId) ?? null,
      listAgentRuns: async (projectId) =>
        this.state.agentRuns
          .filter((run) => run.projectId === projectId)
          .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
          .slice(0, 200),
    },
    audit: {
      append: async (event) => {
        this.state.auditEvents.push(event);
      },
      list: async (projectId) =>
        this.state.auditEvents
          .filter((event) => event.projectId === projectId)
          .sort((left, right) => right.occurredAt.localeCompare(left.occurredAt))
          .slice(0, 500),
    },
  };

  public async run<T>(operation: (repositories: CceRepositories) => Promise<T>): Promise<T> {
    const backup = structuredClone(this.state);
    try {
      return await operation(this.repositories);
    } catch (error: unknown) {
      this.state = backup;
      throw error;
    }
  }

  public seedUser(user: User, tokenHash?: string): void {
    this.state.users.push(user);
    if (tokenHash !== undefined) {
      this.state.tokenHashes.set(tokenHash, user.id);
    }
  }

  public seedProject(project: Project, member: ProjectMember, genesis: ContextCommit): void {
    this.state.projects.push(project);
    this.state.members.push(member);
    this.state.commits.push(genesis);
  }

  public seedConversation(
    conversation: Conversation,
    branch: Branch,
    messages: readonly Message[] = [],
  ): void {
    this.state.conversations.push(conversation);
    this.state.branches.push(branch);
    this.state.messages.push(...messages);
  }

  public seedDelta(delta: ContextDelta): void {
    this.state.deltas.push(delta);
  }

  public view(): Readonly<MemoryState> {
    return this.state;
  }

  private buildSnapshot(
    projectId: Project["id"],
    commitId: ContextCommit["id"],
  ): ContextSnapshot | null {
    const target = this.state.commits.find(
      (commit) => commit.projectId === projectId && commit.id === commitId,
    );
    if (target === undefined) {
      return null;
    }
    const commits = this.state.commits
      .filter((commit) => commit.projectId === projectId && commit.version <= target.version)
      .sort((left, right) => left.version - right.version);
    const items = new Map<string, ContextItemVersion>();
    for (const commit of commits) {
      for (const change of commit.changes) {
        items.set(change.logicalItemId, change.afterVersion);
      }
    }
    return {
      projectId,
      commitId,
      version: target.version,
      items: [...items.values()],
      ancestorCommitIds: commits
        .filter((commit) => commit.version < target.version)
        .map((commit) => commit.id),
      appliedDeltaIds: commits.flatMap((commit) => commit.sourceDeltaIds),
    };
  }
}
