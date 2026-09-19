import type {
  AgentRun,
  AgentRunId,
  AuditEvent,
  Branch,
  ContextCommit,
  ContextCommitChange,
  ContextCommitId,
  ContextDelta,
  ContextDeltaId,
  ContextItemVersion,
  Conversation,
  ConversationId,
  MergeConflict,
  MergeConflictId,
  MergeFinalization,
  MergeRequest,
  MergeRequestId,
  MergeResolution,
  Message,
  ModelRun,
  ModelRunId,
  Project,
  ProjectId,
  ProjectMember,
  User,
  UserId,
} from "@cce/domain";
import type { ContextSnapshot } from "@cce/context-engine";
import type { ExternalConversation } from "@cce/conversation-import";

export interface ConversationImportRecord {
  readonly id: string;
  readonly projectId: ProjectId;
  readonly source: "chatgpt" | "chatgpt-plugin" | "codex-plugin";
  readonly sourceFormat: "json" | "zip" | "mcp";
  readonly sourceFileHash: string;
  readonly policy: "current_path" | "provided_messages";
  readonly status: "completed";
  readonly createdBy: UserId;
  readonly createdAt: string;
  readonly completedAt: string;
  readonly conversationCount: number;
  readonly messageCount: number;
  readonly warnings: readonly string[];
  readonly sourceManifest: readonly ExternalConversation[];
  readonly importedConversations: readonly {
    externalConversationId?: string | undefined;
    conversationId: ConversationId;
    messageIds: readonly string[];
  }[];
}

export interface ConversationImportPreviewRecord {
  readonly id: string;
  readonly projectId: ProjectId;
  readonly source: "chatgpt-plugin" | "codex-plugin";
  readonly sourceFileHash: string;
  readonly createdBy: UserId;
  readonly createdAt: string;
  readonly expiresAt: string;
  readonly messageCount: number;
  readonly unsupportedContentCount: number;
  readonly warnings: readonly string[];
  readonly conversation: ExternalConversation;
}

export interface ConversationImportRepository {
  findById(projectId: ProjectId, importId: string): Promise<ConversationImportRecord | null>;
  findContinuation(
    projectId: ProjectId,
    previousImportId: string,
  ): Promise<ConversationImportRecord | null>;
  findCompletedByIdentity(
    projectId: ProjectId,
    sourceFileHash: string,
    policy: "current_path" | "provided_messages",
  ): Promise<ConversationImportRecord | null>;
  findPreviewById(
    projectId: ProjectId,
    previewId: string,
  ): Promise<ConversationImportPreviewRecord | null>;
  deleteExpiredPreviews(projectId: ProjectId, expiredBefore: string): Promise<number>;
  insertPreview(record: ConversationImportPreviewRecord): Promise<void>;
  insert(record: ConversationImportRecord): Promise<void>;
}

export interface ProjectAccess {
  readonly project: Project;
  readonly member: ProjectMember;
}

export interface ProjectRepository {
  listForUser(userId: UserId): Promise<readonly ProjectAccess[]>;
  findAccess(projectId: ProjectId, userId: UserId): Promise<ProjectAccess | null>;
  findById(projectId: ProjectId): Promise<Project | null>;
  lockById(projectId: ProjectId): Promise<Project | null>;
  insert(project: Project): Promise<void>;
  updateDetails(project: Project): Promise<void>;
  advanceHead(
    projectId: ProjectId,
    expectedHeadCommitId: ContextCommitId,
    nextHeadCommitId: ContextCommitId,
    nextVersion: number,
  ): Promise<boolean>;
  listMembers(projectId: ProjectId): Promise<readonly ProjectMember[]>;
  insertMember(member: ProjectMember): Promise<void>;
  updateMemberRole(member: ProjectMember): Promise<void>;
}

export interface IdentityRepository {
  findUserById(userId: UserId): Promise<User | null>;
  findUserByEmail(email: string): Promise<User | null>;
  findUserByApiTokenHash(tokenHash: string): Promise<User | null>;
  insertUser(user: User): Promise<void>;
  insertApiToken(input: {
    readonly userId: UserId;
    readonly tokenHash: string;
    readonly label: string;
    readonly createdAt: string;
  }): Promise<void>;
}

export interface ConversationRepository {
  list(projectId: ProjectId): Promise<readonly Conversation[]>;
  find(projectId: ProjectId, conversationId: ConversationId): Promise<Conversation | null>;
  lock(projectId: ProjectId, conversationId: ConversationId): Promise<Conversation | null>;
  findBranch(projectId: ProjectId, branchId: Branch["id"]): Promise<Branch | null>;
  insert(conversation: Conversation, branch: Branch): Promise<void>;
  update(conversation: Conversation, branch: Branch): Promise<void>;
  listMessages(projectId: ProjectId, conversationId: ConversationId): Promise<readonly Message[]>;
  findMessageByClientId(
    projectId: ProjectId,
    conversationId: ConversationId,
    clientMessageId: string,
  ): Promise<Message | null>;
  findAssistantReply(
    projectId: ProjectId,
    conversationId: ConversationId,
    userMessageId: Message["id"],
  ): Promise<Message | null>;
  nextMessageSequence(projectId: ProjectId, conversationId: ConversationId): Promise<number>;
  insertMessage(message: Message): Promise<void>;
  updateStreamingMessage(message: Message): Promise<void>;
}

export interface ContextRepository {
  findDelta(projectId: ProjectId, deltaId: ContextDeltaId): Promise<ContextDelta | null>;
  insertDelta(delta: ContextDelta): Promise<void>;
  getSnapshot(projectId: ProjectId, commitId: ContextCommitId): Promise<ContextSnapshot | null>;
  getHeadSnapshot(projectId: ProjectId): Promise<ContextSnapshot | null>;
  listCurrentItems(projectId: ProjectId): Promise<readonly ContextItemVersion[]>;
  listCommits(projectId: ProjectId): Promise<readonly ContextCommit[]>;
  findCommitByIdempotencyKey(
    projectId: ProjectId,
    idempotencyKey: string,
  ): Promise<ContextCommit | null>;
  insertCommit(commit: ContextCommit): Promise<void>;
  applyProjectionChanges(
    projectId: ProjectId,
    changes: readonly ContextCommitChange[],
  ): Promise<void>;
}

export interface MergeRepository {
  list(projectId: ProjectId): Promise<readonly MergeRequest[]>;
  find(projectId: ProjectId, mergeRequestId: MergeRequestId): Promise<MergeRequest | null>;
  listConflicts(
    projectId: ProjectId,
    mergeRequestId: MergeRequestId,
  ): Promise<readonly MergeConflict[]>;
  insert(request: MergeRequest, conflicts: readonly MergeConflict[]): Promise<void>;
  findFinalization(
    projectId: ProjectId,
    mergeRequestId: MergeRequestId,
  ): Promise<MergeFinalization | null>;
  insertFinalization(finalization: MergeFinalization): Promise<void>;
  saveResolution(
    projectId: ProjectId,
    conflictId: MergeConflictId,
    resolution: MergeResolution,
  ): Promise<void>;
  updateRequest(request: MergeRequest): Promise<void>;
}

export interface RunRepository {
  insertModelRun(run: ModelRun): Promise<void>;
  updateModelRun(run: ModelRun): Promise<void>;
  findModelRun(projectId: ProjectId, runId: ModelRunId): Promise<ModelRun | null>;
  listModelRuns(projectId: ProjectId): Promise<readonly ModelRun[]>;
  insertAgentRun(run: AgentRun): Promise<void>;
  updateAgentRun(run: AgentRun, expectedVersion: number): Promise<boolean>;
  findAgentRun(projectId: ProjectId, runId: AgentRunId): Promise<AgentRun | null>;
  listAgentRuns(projectId: ProjectId): Promise<readonly AgentRun[]>;
}

export interface AuditRepository {
  append(event: AuditEvent): Promise<void>;
  list(projectId: ProjectId): Promise<readonly AuditEvent[]>;
}

export interface CceRepositories {
  readonly identity: IdentityRepository;
  readonly projects: ProjectRepository;
  readonly conversations: ConversationRepository;
  readonly context: ContextRepository;
  readonly merges: MergeRepository;
  readonly runs: RunRepository;
  readonly audit: AuditRepository;
  readonly imports: ConversationImportRepository;
}

export interface UnitOfWork {
  run<T>(operation: (repositories: CceRepositories) => Promise<T>): Promise<T>;
}
