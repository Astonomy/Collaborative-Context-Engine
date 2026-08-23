import type {
  AuditRepository,
  CceRepositories,
  ContextRepository,
  ConversationRepository,
  IdentityRepository,
  MergeRepository,
  ProjectAccess,
  ProjectRepository,
  RunRepository,
} from "@cce/application";
import {
  agentRunSchema,
  auditEventSchema,
  branchSchema,
  contextCommitIdSchema,
  contextCommitChangeSchema,
  contextCommitSchema,
  contextDeltaIdSchema,
  contextDeltaSchema,
  contextItemVersionSchema,
  conversationSchema,
  dateTimeSchema,
  mergeConflictSchema,
  mergeFinalizationSchema,
  mergeRequestSchema,
  mergeResolutionSchema,
  messageSchema,
  modelRunSchema,
  projectMemberSchema,
  projectSchema,
  userIdSchema,
  userSchema,
  type AgentRun,
  type AgentRunId,
  type AuditEvent,
  type Branch,
  type ContextCommit,
  type ContextCommitChange,
  type ContextCommitId,
  type ContextDelta,
  type ContextDeltaId,
  type ContextItemVersion,
  type Conversation,
  type ConversationId,
  type MergeConflict,
  type MergeConflictId,
  type MergeFinalization,
  type MergeRequest,
  type MergeRequestId,
  type MergeResolution,
  type Message,
  type ModelRun,
  type Project,
  type ProjectId,
  type ProjectMember,
  type User,
  type UserId,
} from "@cce/domain";
import { and, asc, desc, eq, inArray, lte, max, sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { z } from "zod";

import { DatabaseError } from "./database-error";
import { databaseTimestamp, nullableDatabaseTimestamp, requireRecord } from "./database-values";
import {
  agentRuns,
  apiTokens,
  auditEvents,
  branches,
  contextCommitChanges,
  contextCommitSources,
  contextCommits,
  contextDeltaChanges,
  contextDeltas,
  contextItemProvenance,
  contextItemProvenanceMessages,
  contextItemVersions,
  conversations,
  currentContextItems,
  mergeConflicts,
  mergeFinalizations,
  mergeRequests,
  messages,
  modelRuns,
  projectMembers,
  projects,
  users,
  type DatabaseSchema,
} from "./schema";

export type DatabaseSession = NodePgDatabase<DatabaseSchema>;

const apiTokenInputSchema = z
  .object({
    userId: userIdSchema,
    tokenHash: z.string().regex(/^[a-f0-9]{64}$/),
    label: z.string().trim().min(1).max(160),
    createdAt: dateTimeSchema,
  })
  .strict();

type UserRow = typeof users.$inferSelect;
type ProjectRow = typeof projects.$inferSelect;
type MemberRow = typeof projectMembers.$inferSelect;
type ConversationRow = typeof conversations.$inferSelect;
type BranchRow = typeof branches.$inferSelect;
type MessageRow = typeof messages.$inferSelect;
type CommitRow = typeof contextCommits.$inferSelect;
type DeltaRow = typeof contextDeltas.$inferSelect;
type MergeRequestRow = typeof mergeRequests.$inferSelect;
type MergeConflictRow = typeof mergeConflicts.$inferSelect;
type MergeFinalizationRow = typeof mergeFinalizations.$inferSelect;
type AgentRunRow = typeof agentRuns.$inferSelect;
type ModelRunRow = typeof modelRuns.$inferSelect;
type AuditEventRow = typeof auditEvents.$inferSelect;

export function parsePersisted<Schema extends z.ZodType>(
  schema: Schema,
  value: unknown,
  recordType: string,
): z.output<Schema> {
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    throw new DatabaseError("CORRUPT_DATA", `Persisted ${recordType} is invalid.`);
  }
  return parsed.data;
}

function userFromRow(row: UserRow): User {
  return parsePersisted(userSchema, {
    id: row.id,
    email: row.email,
    displayName: row.displayName,
    createdAt: databaseTimestamp(row.createdAt),
  }, "user");
}

function projectFromRow(row: ProjectRow): Project {
  return parsePersisted(projectSchema, {
    id: row.projectId,
    name: row.name,
    headCommitId: row.headCommitId,
    version: row.version,
    createdBy: row.createdBy,
    createdAt: databaseTimestamp(row.createdAt),
    archivedAt: nullableDatabaseTimestamp(row.archivedAt),
  }, "project");
}

function memberFromRow(row: MemberRow): ProjectMember {
  return parsePersisted(projectMemberSchema, {
    projectId: row.projectId,
    userId: row.userId,
    role: row.role,
    joinedAt: databaseTimestamp(row.joinedAt),
  }, "project member");
}

function conversationFromRow(row: ConversationRow): Conversation {
  return parsePersisted(conversationSchema, {
    id: row.id,
    projectId: row.projectId,
    branchId: row.branchId,
    title: row.title,
    status: row.status,
    createdBy: row.createdBy,
    createdAt: databaseTimestamp(row.createdAt),
    archivedAt: nullableDatabaseTimestamp(row.archivedAt),
  }, "conversation");
}

function branchFromRow(row: BranchRow): Branch {
  return parsePersisted(branchSchema, {
    id: row.id,
    projectId: row.projectId,
    conversationId: row.conversationId,
    baseCommitId: row.baseCommitId,
    status: row.status,
    createdAt: databaseTimestamp(row.createdAt),
    closedAt: nullableDatabaseTimestamp(row.closedAt),
  }, "branch");
}

function messageFromRow(row: MessageRow): Message {
  return parsePersisted(messageSchema, {
    id: row.id,
    projectId: row.projectId,
    conversationId: row.conversationId,
    sequence: row.sequence,
    clientMessageId: row.clientMessageId,
    replyToMessageId: row.replyToMessageId,
    role: row.role,
    deliveryState: row.deliveryState,
    content: row.content,
    author: row.author,
    providerMessageId: row.providerMessageId,
    errorCode: row.errorCode,
    createdAt: databaseTimestamp(row.createdAt),
    completedAt: nullableDatabaseTimestamp(row.completedAt),
  }, "message");
}

function mergeRequestFromRow(row: MergeRequestRow): MergeRequest {
  return parsePersisted(mergeRequestSchema, {
    id: row.id,
    projectId: row.projectId,
    branchId: row.branchId,
    deltaId: row.deltaId,
    baseCommitId: row.baseCommitId,
    evaluatedHeadCommitId: row.evaluatedHeadCommitId,
    resultingCommitId: row.resultingCommitId,
    status: row.status,
    createdBy: row.createdBy,
    createdAt: databaseTimestamp(row.createdAt),
    updatedAt: databaseTimestamp(row.updatedAt),
  }, "merge request");
}

function mergeFinalizationFromRow(row: MergeFinalizationRow): MergeFinalization {
  return parsePersisted(mergeFinalizationSchema, {
    projectId: row.projectId,
    mergeRequestId: row.mergeRequestId,
    operationKey: row.operationKey,
    outcome: row.outcome,
    resultingCommitId: row.resultingCommitId,
    finalizedAt: databaseTimestamp(row.finalizedAt),
  }, "merge finalization");
}

function mergeConflictFromRow(row: MergeConflictRow): MergeConflict {
  return parsePersisted(mergeConflictSchema, {
    id: row.id,
    projectId: row.projectId,
    mergeRequestId: row.mergeRequestId,
    deltaChangeId: row.deltaChangeId,
    classification: row.classification,
    baseVersion: row.baseVersion,
    currentVersion: row.currentVersion,
    proposed: row.proposed,
    reason: row.reason,
    requiresHumanReview: row.requiresHumanReview,
    resolution: row.resolution,
    createdAt: databaseTimestamp(row.createdAt),
  }, "merge conflict");
}

function agentRunFromRow(row: AgentRunRow): AgentRun {
  return parsePersisted(agentRunSchema, {
    id: row.id,
    projectId: row.projectId,
    agentName: row.agentName,
    status: row.status,
    version: row.version,
    state: row.state,
    createdAt: databaseTimestamp(row.createdAt),
    updatedAt: databaseTimestamp(row.updatedAt),
  }, "agent run");
}

function modelRunFromRow(row: ModelRunRow): ModelRun {
  return parsePersisted(modelRunSchema, {
    id: row.id,
    projectId: row.projectId,
    conversationId: row.conversationId,
    provider: row.provider,
    model: row.model,
    purpose: row.purpose,
    promptId: row.promptId,
    promptVersion: row.promptVersion,
    inputHash: row.inputHash,
    status: row.status,
    inputTokens: row.inputTokens,
    cachedTokens: row.cachedTokens,
    outputTokens: row.outputTokens,
    latencyMs: row.latencyMs,
    errorCode: row.errorCode,
    createdAt: databaseTimestamp(row.createdAt),
    completedAt: nullableDatabaseTimestamp(row.completedAt),
  }, "model run");
}

function auditEventFromRow(row: AuditEventRow): AuditEvent {
  return parsePersisted(auditEventSchema, {
    id: row.id,
    projectId: row.projectId,
    actor: row.actor,
    action: row.action,
    targetType: row.targetType,
    targetId: row.targetId,
    metadata: row.metadata,
    occurredAt: databaseTimestamp(row.occurredAt),
  }, "audit event");
}

export class PostgresIdentityRepository implements IdentityRepository {
  public constructor(private readonly session: DatabaseSession) {}

  public async findUserById(userId: UserId): Promise<User | null> {
    const rows = await this.session.select().from(users).where(eq(users.id, userId)).limit(1);
    return rows[0] === undefined ? null : userFromRow(rows[0]);
  }

  public async findUserByEmail(email: string): Promise<User | null> {
    const normalizedEmail = z.email().max(320).parse(email).toLowerCase();
    const rows = await this.session
      .select()
      .from(users)
      .where(sql`lower(${users.email}) = ${normalizedEmail}`)
      .limit(1);
    return rows[0] === undefined ? null : userFromRow(rows[0]);
  }

  public async findUserByApiTokenHash(tokenHash: string): Promise<User | null> {
    const validatedHash = z
      .string()
      .regex(/^[a-f0-9]{64}$/)
      .parse(tokenHash);
    const rows = await this.session
      .select({ user: users })
      .from(apiTokens)
      .innerJoin(users, eq(apiTokens.userId, users.id))
      .where(eq(apiTokens.tokenHash, validatedHash))
      .limit(1);
    return rows[0] === undefined ? null : userFromRow(rows[0].user);
  }

  public async insertUser(untrustedUser: User): Promise<void> {
    const user = userSchema.parse(untrustedUser);
    await this.session.insert(users).values({
      id: user.id,
      email: user.email,
      displayName: user.displayName,
      createdAt: user.createdAt,
    });
  }

  public async insertApiToken(untrustedInput: {
    readonly userId: UserId;
    readonly tokenHash: string;
    readonly label: string;
    readonly createdAt: string;
  }): Promise<void> {
    const input = apiTokenInputSchema.parse(untrustedInput);
    await this.session.insert(apiTokens).values(input);
  }
}

export class PostgresProjectRepository implements ProjectRepository {
  public constructor(private readonly session: DatabaseSession) {}

  public async listForUser(userId: UserId): Promise<readonly ProjectAccess[]> {
    const rows = await this.session
      .select({ project: projects, member: projectMembers })
      .from(projectMembers)
      .innerJoin(projects, eq(projectMembers.projectId, projects.projectId))
      .where(eq(projectMembers.userId, userId))
      .orderBy(desc(projects.createdAt), asc(projects.projectId));
    return rows.map((row) => ({
      project: projectFromRow(row.project),
      member: memberFromRow(row.member),
    }));
  }

  public async findAccess(projectId: ProjectId, userId: UserId): Promise<ProjectAccess | null> {
    const rows = await this.session
      .select({ project: projects, member: projectMembers })
      .from(projectMembers)
      .innerJoin(projects, eq(projectMembers.projectId, projects.projectId))
      .where(and(eq(projectMembers.projectId, projectId), eq(projectMembers.userId, userId)))
      .limit(1);
    const row = rows[0];
    return row === undefined
      ? null
      : { project: projectFromRow(row.project), member: memberFromRow(row.member) };
  }

  public async findById(projectId: ProjectId): Promise<Project | null> {
    const rows = await this.session
      .select()
      .from(projects)
      .where(eq(projects.projectId, projectId))
      .limit(1);
    return rows[0] === undefined ? null : projectFromRow(rows[0]);
  }

  public async lockById(projectId: ProjectId): Promise<Project | null> {
    const rows = await this.session
      .select()
      .from(projects)
      .where(eq(projects.projectId, projectId))
      .limit(1)
      .for("update");
    return rows[0] === undefined ? null : projectFromRow(rows[0]);
  }

  public async insert(untrustedProject: Project): Promise<void> {
    const project = projectSchema.parse(untrustedProject);
    await this.session.insert(projects).values({
      projectId: project.id,
      name: project.name,
      headCommitId: project.headCommitId,
      version: project.version,
      createdBy: project.createdBy,
      createdAt: project.createdAt,
      archivedAt: project.archivedAt,
    });
  }

  public async updateDetails(untrustedProject: Project): Promise<void> {
    const project = projectSchema.parse(untrustedProject);
    const rows = await this.session
      .update(projects)
      .set({ name: project.name, archivedAt: project.archivedAt })
      .where(
        and(
          eq(projects.projectId, project.id),
          eq(projects.headCommitId, project.headCommitId),
          eq(projects.version, project.version),
          eq(projects.createdBy, project.createdBy),
          eq(projects.createdAt, project.createdAt),
        ),
      )
      .returning({ projectId: projects.projectId });
    if (rows.length !== 1) {
      throw new DatabaseError("WRITE_CONFLICT", "Project details changed concurrently.");
    }
  }

  public async advanceHead(
    projectId: ProjectId,
    expectedHeadCommitId: ContextCommitId,
    nextHeadCommitId: ContextCommitId,
    nextVersion: number,
  ): Promise<boolean> {
    const parsedNextVersion = z.int().positive().parse(nextVersion);
    const rows = await this.session
      .update(projects)
      .set({ headCommitId: nextHeadCommitId, version: parsedNextVersion })
      .where(
        and(
          eq(projects.projectId, projectId),
          eq(projects.headCommitId, expectedHeadCommitId),
          eq(projects.version, parsedNextVersion - 1),
        ),
      )
      .returning({ projectId: projects.projectId });
    return rows.length === 1;
  }

  public async listMembers(projectId: ProjectId): Promise<readonly ProjectMember[]> {
    const rows = await this.session
      .select()
      .from(projectMembers)
      .where(eq(projectMembers.projectId, projectId))
      .orderBy(asc(projectMembers.joinedAt), asc(projectMembers.userId));
    return rows.map(memberFromRow);
  }

  public async insertMember(untrustedMember: ProjectMember): Promise<void> {
    const member = projectMemberSchema.parse(untrustedMember);
    await this.session.insert(projectMembers).values({
      projectId: member.projectId,
      userId: member.userId,
      role: member.role,
      joinedAt: member.joinedAt,
    });
  }

  public async updateMemberRole(untrustedMember: ProjectMember): Promise<void> {
    const member = projectMemberSchema.parse(untrustedMember);
    const rows = await this.session
      .update(projectMembers)
      .set({ role: member.role })
      .where(
        and(
          eq(projectMembers.projectId, member.projectId),
          eq(projectMembers.userId, member.userId),
        ),
      )
      .returning({ userId: projectMembers.userId });
    if (rows.length !== 1) {
      throw new DatabaseError("NOT_FOUND", "Project member was not found.");
    }
  }
}

export class PostgresConversationRepository implements ConversationRepository {
  public constructor(private readonly session: DatabaseSession) {}

  public async list(projectId: ProjectId): Promise<readonly Conversation[]> {
    const rows = await this.session
      .select()
      .from(conversations)
      .where(eq(conversations.projectId, projectId))
      .orderBy(desc(conversations.createdAt), asc(conversations.id));
    return rows.map(conversationFromRow);
  }

  public async find(
    projectId: ProjectId,
    conversationId: ConversationId,
  ): Promise<Conversation | null> {
    const rows = await this.session
      .select()
      .from(conversations)
      .where(and(eq(conversations.projectId, projectId), eq(conversations.id, conversationId)))
      .limit(1);
    return rows[0] === undefined ? null : conversationFromRow(rows[0]);
  }

  public async lock(
    projectId: ProjectId,
    conversationId: ConversationId,
  ): Promise<Conversation | null> {
    const rows = await this.session
      .select()
      .from(conversations)
      .where(and(eq(conversations.projectId, projectId), eq(conversations.id, conversationId)))
      .for("update")
      .limit(1);
    return rows[0] === undefined ? null : conversationFromRow(rows[0]);
  }

  public async findBranch(projectId: ProjectId, branchId: Branch["id"]): Promise<Branch | null> {
    const rows = await this.session
      .select()
      .from(branches)
      .where(and(eq(branches.projectId, projectId), eq(branches.id, branchId)))
      .limit(1);
    return rows[0] === undefined ? null : branchFromRow(rows[0]);
  }

  public async insert(untrustedConversation: Conversation, untrustedBranch: Branch): Promise<void> {
    const conversation = conversationSchema.parse(untrustedConversation);
    const branch = branchSchema.parse(untrustedBranch);
    if (
      conversation.projectId !== branch.projectId ||
      conversation.id !== branch.conversationId ||
      conversation.branchId !== branch.id
    ) {
      throw new DatabaseError("WRITE_CONFLICT", "Conversation and Branch scope do not match.");
    }
    await this.session.insert(conversations).values({
      projectId: conversation.projectId,
      id: conversation.id,
      branchId: conversation.branchId,
      title: conversation.title,
      status: conversation.status,
      createdBy: conversation.createdBy,
      createdAt: conversation.createdAt,
      archivedAt: conversation.archivedAt,
    });
    await this.session.insert(branches).values({
      projectId: branch.projectId,
      id: branch.id,
      conversationId: branch.conversationId,
      baseCommitId: branch.baseCommitId,
      status: branch.status,
      createdAt: branch.createdAt,
      closedAt: branch.closedAt,
    });
  }

  public async update(
    untrustedConversation: Conversation,
    untrustedBranch: Branch,
  ): Promise<void> {
    const conversation = conversationSchema.parse(untrustedConversation);
    const branch = branchSchema.parse(untrustedBranch);
    if (
      conversation.projectId !== branch.projectId ||
      conversation.id !== branch.conversationId ||
      conversation.branchId !== branch.id
    ) {
      throw new DatabaseError("WRITE_CONFLICT", "Conversation and Branch scope do not match.");
    }
    const conversationRows = await this.session
      .update(conversations)
      .set({
        title: conversation.title,
        status: conversation.status,
        archivedAt: conversation.archivedAt,
      })
      .where(
        and(
          eq(conversations.projectId, conversation.projectId),
          eq(conversations.id, conversation.id),
          eq(conversations.branchId, conversation.branchId),
          eq(conversations.createdAt, conversation.createdAt),
        ),
      )
      .returning({ id: conversations.id });
    if (conversationRows.length !== 1) {
      throw new DatabaseError("WRITE_CONFLICT", "Conversation details changed concurrently.");
    }
    const branchRows = await this.session
      .update(branches)
      .set({ status: branch.status, closedAt: branch.closedAt })
      .where(
        and(
          eq(branches.projectId, branch.projectId),
          eq(branches.id, branch.id),
          eq(branches.conversationId, branch.conversationId),
          eq(branches.baseCommitId, branch.baseCommitId),
          eq(branches.createdAt, branch.createdAt),
        ),
      )
      .returning({ id: branches.id });
    if (branchRows.length !== 1) {
      throw new DatabaseError("WRITE_CONFLICT", "Conversation Branch changed concurrently.");
    }
  }

  public async listMessages(
    projectId: ProjectId,
    conversationId: ConversationId,
  ): Promise<readonly Message[]> {
    const rows = await this.session
      .select()
      .from(messages)
      .where(and(eq(messages.projectId, projectId), eq(messages.conversationId, conversationId)))
      .orderBy(asc(messages.sequence));
    return rows.map(messageFromRow);
  }

  public async findMessageByClientId(
    projectId: ProjectId,
    conversationId: ConversationId,
    clientMessageId: string,
  ): Promise<Message | null> {
    const validatedClientMessageId = z.uuid().parse(clientMessageId);
    const rows = await this.session
      .select()
      .from(messages)
      .where(
        and(
          eq(messages.projectId, projectId),
          eq(messages.conversationId, conversationId),
          eq(messages.clientMessageId, validatedClientMessageId),
        ),
      )
      .limit(1);
    return rows[0] === undefined ? null : messageFromRow(rows[0]);
  }

  public async findAssistantReply(
    projectId: ProjectId,
    conversationId: ConversationId,
    userMessageId: Message["id"],
  ): Promise<Message | null> {
    const rows = await this.session
      .select()
      .from(messages)
      .where(
        and(
          eq(messages.projectId, projectId),
          eq(messages.conversationId, conversationId),
          eq(messages.replyToMessageId, userMessageId),
          eq(messages.role, "assistant"),
        ),
      )
      .limit(1);
    return rows[0] === undefined ? null : messageFromRow(rows[0]);
  }

  public async nextMessageSequence(
    projectId: ProjectId,
    conversationId: ConversationId,
  ): Promise<number> {
    const locked = await this.session
      .select({ id: conversations.id })
      .from(conversations)
      .where(and(eq(conversations.projectId, projectId), eq(conversations.id, conversationId)))
      .limit(1)
      .for("update");
    if (locked.length !== 1) {
      throw new DatabaseError("NOT_FOUND", "Conversation was not found.");
    }
    const rows = await this.session
      .select({ greatestSequence: max(messages.sequence) })
      .from(messages)
      .where(and(eq(messages.projectId, projectId), eq(messages.conversationId, conversationId)));
    return (rows[0]?.greatestSequence ?? 0) + 1;
  }

  public async insertMessage(untrustedMessage: Message): Promise<void> {
    const message = messageSchema.parse(untrustedMessage);
    await this.session.insert(messages).values({
      projectId: message.projectId,
      id: message.id,
      conversationId: message.conversationId,
      sequence: message.sequence,
      clientMessageId: message.clientMessageId,
      replyToMessageId: message.replyToMessageId,
      role: message.role,
      deliveryState: message.deliveryState,
      content: message.content,
      author: message.author,
      providerMessageId: message.providerMessageId,
      errorCode: message.errorCode,
      createdAt: message.createdAt,
      completedAt: message.completedAt,
    });
  }

  public async updateStreamingMessage(untrustedMessage: Message): Promise<void> {
    const message = messageSchema.parse(untrustedMessage);
    const rows = await this.session
      .update(messages)
      .set({
        deliveryState: message.deliveryState,
        content: message.content,
        author: message.author,
        providerMessageId: message.providerMessageId,
        errorCode: message.errorCode,
        completedAt: message.completedAt,
      })
      .where(
        and(
          eq(messages.projectId, message.projectId),
          eq(messages.id, message.id),
          eq(messages.conversationId, message.conversationId),
          inArray(messages.deliveryState, ["pending", "streaming"]),
        ),
      )
      .returning({ id: messages.id });
    if (rows.length !== 1) {
      throw new DatabaseError("WRITE_CONFLICT", "Streaming message is missing or terminal.");
    }
  }
}

interface ProvenanceRecord {
  readonly projectId: string;
  readonly contextItemVersionId: string;
  readonly ordinal: number;
  readonly conversationId: string;
  readonly actor: unknown;
  readonly modelRunId: string | null;
  readonly recordedAt: string;
}

interface ProvenanceMessageRecord {
  readonly projectId: string;
  readonly contextItemVersionId: string;
  readonly provenanceOrdinal: number;
  readonly messageOrdinal: number;
  readonly conversationId: string;
  readonly messageId: string;
}

function provenanceKey(versionId: string, ordinal: number): string {
  return `${versionId}:${ordinal}`;
}

async function loadItemVersions(
  session: DatabaseSession,
  projectId: ProjectId,
  untrustedVersionIds: readonly string[],
): Promise<ReadonlyMap<string, ContextItemVersion>> {
  const versionIds = [...new Set(untrustedVersionIds)];
  if (versionIds.length === 0) {
    return new Map();
  }

  const [versionRows, provenanceRows, provenanceMessageRows] = await Promise.all([
    session
      .select()
      .from(contextItemVersions)
      .where(
        and(
          eq(contextItemVersions.projectId, projectId),
          inArray(contextItemVersions.id, versionIds),
        ),
      ),
    session
      .select()
      .from(contextItemProvenance)
      .where(
        and(
          eq(contextItemProvenance.projectId, projectId),
          inArray(contextItemProvenance.contextItemVersionId, versionIds),
        ),
      )
      .orderBy(asc(contextItemProvenance.contextItemVersionId), asc(contextItemProvenance.ordinal)),
    session
      .select()
      .from(contextItemProvenanceMessages)
      .where(
        and(
          eq(contextItemProvenanceMessages.projectId, projectId),
          inArray(contextItemProvenanceMessages.contextItemVersionId, versionIds),
        ),
      )
      .orderBy(
        asc(contextItemProvenanceMessages.contextItemVersionId),
        asc(contextItemProvenanceMessages.provenanceOrdinal),
        asc(contextItemProvenanceMessages.messageOrdinal),
      ),
  ]);

  const provenanceByVersion = new Map<string, ProvenanceRecord[]>();
  for (const row of provenanceRows) {
    const existing = provenanceByVersion.get(row.contextItemVersionId) ?? [];
    existing.push(row);
    provenanceByVersion.set(row.contextItemVersionId, existing);
  }

  const messagesByProvenance = new Map<string, ProvenanceMessageRecord[]>();
  for (const row of provenanceMessageRows) {
    const key = provenanceKey(row.contextItemVersionId, row.provenanceOrdinal);
    const existing = messagesByProvenance.get(key) ?? [];
    existing.push(row);
    messagesByProvenance.set(key, existing);
  }

  const records = new Map<string, ContextItemVersion>();
  for (const row of versionRows) {
    const provenance = (provenanceByVersion.get(row.id) ?? []).map((source) => {
      const messageRows = messagesByProvenance.get(provenanceKey(row.id, source.ordinal)) ?? [];
      if (messageRows.some((message) => message.conversationId !== source.conversationId)) {
        throw new DatabaseError(
          "CORRUPT_DATA",
          `Context item version ${row.id} contains cross-conversation provenance.`,
        );
      }
      return {
        projectId: source.projectId,
        conversationId: source.conversationId,
        messageIds: messageRows.map((message) => message.messageId),
        actor: source.actor,
        modelRunId: source.modelRunId,
        recordedAt: databaseTimestamp(source.recordedAt),
      };
    });
    const item = parsePersisted(contextItemVersionSchema, {
      id: row.id,
      logicalItemId: row.logicalItemId,
      projectId: row.projectId,
      commitId: row.commitId,
      previousVersionId: row.previousVersionId,
      kind: row.kind,
      key: row.key,
      value: row.value,
      scope: row.scope,
      authority: row.authority,
      confidence: row.confidence,
      provenance,
      lifecycle: row.lifecycle,
      scopeHash: row.scopeHash,
      supersedesVersionId: row.supersedesVersionId,
      createdAt: databaseTimestamp(row.createdAt),
    }, "context item version");
    records.set(item.id, item);
  }

  if (records.size !== versionIds.length) {
    throw new DatabaseError("CORRUPT_DATA", "A referenced context item version is missing.");
  }
  return records;
}

async function loadCommits(
  session: DatabaseSession,
  projectId: ProjectId,
  commitRows: readonly CommitRow[],
): Promise<readonly ContextCommit[]> {
  if (commitRows.length === 0) {
    return [];
  }
  const commitIds = commitRows.map((commit) => commit.id);
  const [sourceRows, changeRows] = await Promise.all([
    session
      .select()
      .from(contextCommitSources)
      .where(
        and(
          eq(contextCommitSources.projectId, projectId),
          inArray(contextCommitSources.commitId, commitIds),
        ),
      )
      .orderBy(asc(contextCommitSources.commitId), asc(contextCommitSources.ordinal)),
    session
      .select()
      .from(contextCommitChanges)
      .where(
        and(
          eq(contextCommitChanges.projectId, projectId),
          inArray(contextCommitChanges.commitId, commitIds),
        ),
      )
      .orderBy(asc(contextCommitChanges.commitId), asc(contextCommitChanges.ordinal)),
  ]);

  const versionIds = changeRows.flatMap((change) =>
    change.beforeVersionId === null
      ? [change.afterVersionId]
      : [change.beforeVersionId, change.afterVersionId],
  );
  const versions = await loadItemVersions(session, projectId, versionIds);
  const sourcesByCommit = new Map<string, string[]>();
  for (const source of sourceRows) {
    const existing = sourcesByCommit.get(source.commitId) ?? [];
    existing.push(source.deltaId);
    sourcesByCommit.set(source.commitId, existing);
  }
  const changesByCommit = new Map<string, ContextCommitChange[]>();
  for (const row of changeRows) {
    const change = parsePersisted(contextCommitChangeSchema, {
      id: row.id,
      ordinal: row.ordinal,
      operation: row.operation,
      logicalItemId: row.logicalItemId,
      beforeVersion:
        row.beforeVersionId === null
          ? null
          : requireRecord(versions, row.beforeVersionId, "Context item version"),
      afterVersion: requireRecord(versions, row.afterVersionId, "Context item version"),
      sourceDeltaId: row.sourceDeltaId,
      sourceDeltaChangeId: row.sourceDeltaChangeId,
    }, "context commit change");
    const existing = changesByCommit.get(row.commitId) ?? [];
    existing.push(change);
    changesByCommit.set(row.commitId, existing);
  }

  return commitRows.map((row) =>
    parsePersisted(contextCommitSchema, {
      id: row.id,
      projectId: row.projectId,
      kind: row.kind,
      parentCommitId: row.parentCommitId,
      version: row.version,
      idempotencyKey: row.idempotencyKey,
      summary: row.summary,
      sourceDeltaIds: sourcesByCommit.get(row.id) ?? [],
      proposedBy: row.proposedBy,
      committedBy: row.committedBy,
      changes: changesByCommit.get(row.id) ?? [],
      createdAt: databaseTimestamp(row.createdAt),
    }, "context commit"),
  );
}

async function deltaFromRow(session: DatabaseSession, row: DeltaRow): Promise<ContextDelta> {
  const changes = await session
    .select({ payload: contextDeltaChanges.payload })
    .from(contextDeltaChanges)
    .where(
      and(
        eq(contextDeltaChanges.projectId, row.projectId),
        eq(contextDeltaChanges.deltaId, row.id),
      ),
    )
    .orderBy(asc(contextDeltaChanges.ordinal));
  return parsePersisted(contextDeltaSchema, {
    id: row.id,
    projectId: row.projectId,
    branchId: row.branchId,
    conversationId: row.conversationId,
    baseCommitId: row.baseCommitId,
    throughMessageSequence: row.throughMessageSequence,
    schemaVersion: row.schemaVersion,
    extractorRunId: row.extractorRunId,
    revisionOf: row.revisionOf,
    contentHash: row.contentHash,
    proposedBy: row.proposedBy,
    createdAt: databaseTimestamp(row.createdAt),
    changes: changes.map((change) => change.payload),
  }, "context delta");
}

type StoredContextSnapshot = NonNullable<Awaited<ReturnType<ContextRepository["getSnapshot"]>>>;

export class PostgresContextRepository implements ContextRepository {
  public constructor(private readonly session: DatabaseSession) {}

  public async findDelta(
    projectId: ProjectId,
    deltaId: ContextDeltaId,
  ): Promise<ContextDelta | null> {
    const rows = await this.session
      .select()
      .from(contextDeltas)
      .where(and(eq(contextDeltas.projectId, projectId), eq(contextDeltas.id, deltaId)))
      .limit(1);
    return rows[0] === undefined ? null : deltaFromRow(this.session, rows[0]);
  }

  public async insertDelta(untrustedDelta: ContextDelta): Promise<void> {
    const delta = contextDeltaSchema.parse(untrustedDelta);
    await this.session.insert(contextDeltas).values({
      projectId: delta.projectId,
      id: delta.id,
      branchId: delta.branchId,
      conversationId: delta.conversationId,
      baseCommitId: delta.baseCommitId,
      throughMessageSequence: delta.throughMessageSequence,
      schemaVersion: delta.schemaVersion,
      extractorRunId: delta.extractorRunId,
      revisionOf: delta.revisionOf,
      contentHash: delta.contentHash,
      proposedBy: delta.proposedBy,
      createdAt: delta.createdAt,
    });
    if (delta.changes.length > 0) {
      await this.session.insert(contextDeltaChanges).values(
        delta.changes.map((change, ordinal) => ({
          projectId: delta.projectId,
          deltaId: delta.id,
          id: change.id,
          ordinal,
          operation: change.operation,
          payload: change,
        })),
      );
    }
  }

  public async getSnapshot(
    projectId: ProjectId,
    commitId: ContextCommitId,
  ): Promise<StoredContextSnapshot | null> {
    const targetRows = await this.session
      .select()
      .from(contextCommits)
      .where(and(eq(contextCommits.projectId, projectId), eq(contextCommits.id, commitId)))
      .limit(1);
    const target = targetRows[0];
    if (target === undefined) {
      return null;
    }

    const candidateRows = await this.session
      .select()
      .from(contextCommits)
      .where(
        and(eq(contextCommits.projectId, projectId), lte(contextCommits.version, target.version)),
      );
    const candidatesById = new Map(candidateRows.map((commit) => [commit.id, commit]));
    const chain: CommitRow[] = [];
    const visited = new Set<string>();
    let cursor: CommitRow | undefined = target;
    while (cursor !== undefined) {
      if (visited.has(cursor.id)) {
        throw new DatabaseError("CORRUPT_DATA", "The context commit ancestry contains a cycle.");
      }
      visited.add(cursor.id);
      chain.push(cursor);
      if (cursor.parentCommitId === null) {
        break;
      }
      const parent = candidatesById.get(cursor.parentCommitId);
      if (parent === undefined || parent.version >= cursor.version) {
        throw new DatabaseError("CORRUPT_DATA", "The context commit ancestry is incomplete.");
      }
      cursor = parent;
    }

    const chainIds = chain.map((commit) => commit.id);
    const versionRows = await this.session
      .select({
        id: contextItemVersions.id,
        logicalItemId: contextItemVersions.logicalItemId,
        commitId: contextItemVersions.commitId,
      })
      .from(contextItemVersions)
      .where(
        and(
          eq(contextItemVersions.projectId, projectId),
          inArray(contextItemVersions.commitId, chainIds),
        ),
      );
    const commitVersionById = new Map(chain.map((commit) => [commit.id, commit.version]));
    const latestVersionByLogicalItem = new Map<
      string,
      { readonly id: string; readonly commitVersion: number }
    >();
    for (const row of versionRows) {
      const commitVersion = commitVersionById.get(row.commitId);
      if (commitVersion === undefined) {
        throw new DatabaseError("CORRUPT_DATA", "A context item references an unknown commit.");
      }
      const current = latestVersionByLogicalItem.get(row.logicalItemId);
      if (current === undefined || commitVersion > current.commitVersion) {
        latestVersionByLogicalItem.set(row.logicalItemId, { id: row.id, commitVersion });
      }
    }
    const latestIds = [...latestVersionByLogicalItem.values()].map((record) => record.id);
    const loadedVersions = await loadItemVersions(this.session, projectId, latestIds);
    const items = [...loadedVersions.values()].sort(
      (left, right) =>
        left.kind.localeCompare(right.kind) ||
        left.key.localeCompare(right.key) ||
        left.logicalItemId.localeCompare(right.logicalItemId),
    );

    const sourceRows = await this.session
      .select()
      .from(contextCommitSources)
      .where(
        and(
          eq(contextCommitSources.projectId, projectId),
          inArray(contextCommitSources.commitId, chainIds),
        ),
      );
    sourceRows.sort(
      (left, right) =>
        (commitVersionById.get(left.commitId) ?? -1) -
          (commitVersionById.get(right.commitId) ?? -1) || left.ordinal - right.ordinal,
    );
    const appliedDeltaIds = parsePersisted(
      contextDeltaIdSchema.array(),
      [...new Set(sourceRows.map((source) => source.deltaId))],
      "context snapshot applied delta IDs",
    );

    return {
      projectId,
      commitId,
      version: target.version,
      items,
      ancestorCommitIds: parsePersisted(
        contextCommitIdSchema.array(),
        chain.slice(1).map((commit) => commit.id),
        "context snapshot ancestor commit IDs",
      ),
      appliedDeltaIds,
    };
  }

  public async getHeadSnapshot(projectId: ProjectId): Promise<StoredContextSnapshot | null> {
    const rows = await this.session
      .select({ headCommitId: projects.headCommitId })
      .from(projects)
      .where(eq(projects.projectId, projectId))
      .limit(1);
    return rows[0] === undefined
      ? null
      : this.getSnapshot(
          projectId,
          parsePersisted(contextCommitIdSchema, rows[0].headCommitId, "project head commit ID"),
        );
  }

  public async listCurrentItems(projectId: ProjectId): Promise<readonly ContextItemVersion[]> {
    const rows = await this.session
      .select({ versionId: currentContextItems.versionId })
      .from(currentContextItems)
      .where(eq(currentContextItems.projectId, projectId))
      .orderBy(asc(currentContextItems.logicalItemId));
    const versions = await loadItemVersions(
      this.session,
      projectId,
      rows.map((row) => row.versionId),
    );
    return rows.map((row) => requireRecord(versions, row.versionId, "Current context item"));
  }

  public async listCommits(projectId: ProjectId): Promise<readonly ContextCommit[]> {
    const rows = await this.session
      .select()
      .from(contextCommits)
      .where(eq(contextCommits.projectId, projectId))
      .orderBy(desc(contextCommits.version));
    return loadCommits(this.session, projectId, rows);
  }

  public async findCommitByIdempotencyKey(
    projectId: ProjectId,
    idempotencyKey: string,
  ): Promise<ContextCommit | null> {
    const validatedKey = z.string().trim().min(1).max(200).parse(idempotencyKey);
    const rows = await this.session
      .select()
      .from(contextCommits)
      .where(
        and(
          eq(contextCommits.projectId, projectId),
          eq(contextCommits.idempotencyKey, validatedKey),
        ),
      )
      .limit(1);
    if (rows[0] === undefined) {
      return null;
    }
    return (await loadCommits(this.session, projectId, rows))[0] ?? null;
  }

  public async insertCommit(untrustedCommit: ContextCommit): Promise<void> {
    const commit = contextCommitSchema.parse(untrustedCommit);
    await this.session.insert(contextCommits).values({
      projectId: commit.projectId,
      id: commit.id,
      kind: commit.kind,
      parentCommitId: commit.parentCommitId,
      version: commit.version,
      idempotencyKey: commit.idempotencyKey,
      summary: commit.summary,
      proposedBy: commit.proposedBy,
      committedBy: commit.committedBy,
      createdAt: commit.createdAt,
    });

    if (commit.sourceDeltaIds.length > 0) {
      await this.session.insert(contextCommitSources).values(
        commit.sourceDeltaIds.map((deltaId, ordinal) => ({
          projectId: commit.projectId,
          commitId: commit.id,
          ordinal,
          deltaId,
        })),
      );
    }

    const afterVersions = commit.changes.map((change) => change.afterVersion);
    if (afterVersions.length > 0) {
      await this.session.insert(contextItemVersions).values(
        afterVersions.map((version) => ({
          projectId: version.projectId,
          id: version.id,
          logicalItemId: version.logicalItemId,
          commitId: version.commitId,
          previousVersionId: version.previousVersionId,
          kind: version.kind,
          key: version.key,
          value: version.value,
          scope: version.scope,
          authority: version.authority,
          confidence: version.confidence,
          lifecycle: version.lifecycle,
          scopeHash: version.scopeHash,
          supersedesVersionId: version.supersedesVersionId,
          createdAt: version.createdAt,
        })),
      );

      const provenanceRows = afterVersions.flatMap((version) =>
        version.provenance.map((source, ordinal) => ({
          projectId: version.projectId,
          contextItemVersionId: version.id,
          ordinal,
          conversationId: source.conversationId,
          actor: source.actor,
          modelRunId: source.modelRunId,
          recordedAt: source.recordedAt,
        })),
      );
      await this.session.insert(contextItemProvenance).values(provenanceRows);

      const provenanceMessageRows = afterVersions.flatMap((version) =>
        version.provenance.flatMap((source, provenanceOrdinal) =>
          source.messageIds.map((messageId, messageOrdinal) => ({
            projectId: version.projectId,
            contextItemVersionId: version.id,
            provenanceOrdinal,
            messageOrdinal,
            conversationId: source.conversationId,
            messageId,
          })),
        ),
      );
      await this.session.insert(contextItemProvenanceMessages).values(provenanceMessageRows);

      await this.session.insert(contextCommitChanges).values(
        commit.changes.map((change) => ({
          projectId: commit.projectId,
          commitId: commit.id,
          id: change.id,
          ordinal: change.ordinal,
          operation: change.operation,
          logicalItemId: change.logicalItemId,
          beforeVersionId: change.beforeVersion?.id ?? null,
          afterVersionId: change.afterVersion.id,
          sourceDeltaId: change.sourceDeltaId,
          sourceDeltaChangeId: change.sourceDeltaChangeId,
        })),
      );
    }
  }

  public async applyProjectionChanges(
    projectId: ProjectId,
    untrustedChanges: readonly ContextCommitChange[],
  ): Promise<void> {
    const changes = contextCommitChangeSchema.array().parse(untrustedChanges);
    if (changes.some((change) => change.afterVersion.projectId !== projectId)) {
      throw new DatabaseError("WRITE_CONFLICT", "Projection changes cross the project boundary.");
    }
    for (const change of changes) {
      await this.session
        .insert(currentContextItems)
        .values({
          projectId,
          logicalItemId: change.logicalItemId,
          versionId: change.afterVersion.id,
        })
        .onConflictDoUpdate({
          target: [currentContextItems.projectId, currentContextItems.logicalItemId],
          set: { versionId: change.afterVersion.id },
        });
    }
  }
}

export class PostgresMergeRepository implements MergeRepository {
  public constructor(private readonly session: DatabaseSession) {}

  public async list(projectId: ProjectId): Promise<readonly MergeRequest[]> {
    const rows = await this.session
      .select()
      .from(mergeRequests)
      .where(eq(mergeRequests.projectId, projectId))
      .orderBy(desc(mergeRequests.updatedAt), asc(mergeRequests.id));
    return rows.map(mergeRequestFromRow);
  }

  public async find(
    projectId: ProjectId,
    mergeRequestId: MergeRequestId,
  ): Promise<MergeRequest | null> {
    const rows = await this.session
      .select()
      .from(mergeRequests)
      .where(and(eq(mergeRequests.projectId, projectId), eq(mergeRequests.id, mergeRequestId)))
      .limit(1);
    return rows[0] === undefined ? null : mergeRequestFromRow(rows[0]);
  }

  public async listConflicts(
    projectId: ProjectId,
    mergeRequestId: MergeRequestId,
  ): Promise<readonly MergeConflict[]> {
    const rows = await this.session
      .select()
      .from(mergeConflicts)
      .where(
        and(
          eq(mergeConflicts.projectId, projectId),
          eq(mergeConflicts.mergeRequestId, mergeRequestId),
        ),
      )
      .orderBy(asc(mergeConflicts.createdAt), asc(mergeConflicts.id));
    return rows.map(mergeConflictFromRow);
  }

  public async insert(
    untrustedRequest: MergeRequest,
    untrustedConflicts: readonly MergeConflict[],
  ): Promise<void> {
    const request = mergeRequestSchema.parse(untrustedRequest);
    const conflicts = mergeConflictSchema.array().parse(untrustedConflicts);
    if (
      conflicts.some(
        (conflict) =>
          conflict.projectId !== request.projectId || conflict.mergeRequestId !== request.id,
      )
    ) {
      throw new DatabaseError("WRITE_CONFLICT", "Merge conflicts do not belong to the request.");
    }

    await this.session.insert(mergeRequests).values({
      projectId: request.projectId,
      id: request.id,
      branchId: request.branchId,
      deltaId: request.deltaId,
      baseCommitId: request.baseCommitId,
      evaluatedHeadCommitId: request.evaluatedHeadCommitId,
      resultingCommitId: request.resultingCommitId,
      status: request.status,
      createdBy: request.createdBy,
      createdAt: request.createdAt,
      updatedAt: request.updatedAt,
    });
    if (conflicts.length > 0) {
      await this.session.insert(mergeConflicts).values(
        conflicts.map((conflict) => ({
          projectId: conflict.projectId,
          id: conflict.id,
          mergeRequestId: conflict.mergeRequestId,
          deltaId: request.deltaId,
          deltaChangeId: conflict.deltaChangeId,
          classification: conflict.classification,
          baseVersion: conflict.baseVersion,
          currentVersion: conflict.currentVersion,
          proposed: conflict.proposed,
          reason: conflict.reason,
          requiresHumanReview: conflict.requiresHumanReview,
          resolution: conflict.resolution,
          createdAt: conflict.createdAt,
        })),
      );
    }
  }

  public async findFinalization(
    projectId: ProjectId,
    mergeRequestId: MergeRequestId,
  ): Promise<MergeFinalization | null> {
    const rows = await this.session
      .select()
      .from(mergeFinalizations)
      .where(
        and(
          eq(mergeFinalizations.projectId, projectId),
          eq(mergeFinalizations.mergeRequestId, mergeRequestId),
        ),
      )
      .limit(1);
    return rows[0] === undefined ? null : mergeFinalizationFromRow(rows[0]);
  }

  public async insertFinalization(untrustedFinalization: MergeFinalization): Promise<void> {
    const finalization = mergeFinalizationSchema.parse(untrustedFinalization);
    await this.session.insert(mergeFinalizations).values({
      projectId: finalization.projectId,
      mergeRequestId: finalization.mergeRequestId,
      operationKey: finalization.operationKey,
      outcome: finalization.outcome,
      resultingCommitId: finalization.resultingCommitId,
      finalizedAt: finalization.finalizedAt,
    });
  }

  public async saveResolution(
    projectId: ProjectId,
    conflictId: MergeConflictId,
    untrustedResolution: MergeResolution,
  ): Promise<void> {
    const resolution = mergeResolutionSchema.parse(untrustedResolution);
    const rows = await this.session
      .update(mergeConflicts)
      .set({ resolution })
      .where(and(eq(mergeConflicts.projectId, projectId), eq(mergeConflicts.id, conflictId)))
      .returning({ id: mergeConflicts.id });
    if (rows.length !== 1) {
      throw new DatabaseError("NOT_FOUND", "Merge conflict was not found.");
    }
  }

  public async updateRequest(untrustedRequest: MergeRequest): Promise<void> {
    const request = mergeRequestSchema.parse(untrustedRequest);
    const rows = await this.session
      .update(mergeRequests)
      .set({
        evaluatedHeadCommitId: request.evaluatedHeadCommitId,
        resultingCommitId: request.resultingCommitId,
        status: request.status,
        updatedAt: request.updatedAt,
      })
      .where(and(eq(mergeRequests.projectId, request.projectId), eq(mergeRequests.id, request.id)))
      .returning({ id: mergeRequests.id });
    if (rows.length !== 1) {
      throw new DatabaseError("NOT_FOUND", "Merge request was not found.");
    }
  }
}

export class PostgresRunRepository implements RunRepository {
  public constructor(private readonly session: DatabaseSession) {}

  public async insertModelRun(untrustedRun: ModelRun): Promise<void> {
    const run = modelRunSchema.parse(untrustedRun);
    await this.session.insert(modelRuns).values({
      projectId: run.projectId,
      id: run.id,
      conversationId: run.conversationId,
      provider: run.provider,
      model: run.model,
      purpose: run.purpose,
      promptId: run.promptId,
      promptVersion: run.promptVersion,
      inputHash: run.inputHash,
      status: run.status,
      inputTokens: run.inputTokens,
      cachedTokens: run.cachedTokens,
      outputTokens: run.outputTokens,
      latencyMs: run.latencyMs,
      errorCode: run.errorCode,
      createdAt: run.createdAt,
      completedAt: run.completedAt,
    });
  }

  public async updateModelRun(untrustedRun: ModelRun): Promise<void> {
    const run = modelRunSchema.parse(untrustedRun);
    const rows = await this.session
      .update(modelRuns)
      .set({
        provider: run.provider,
        model: run.model,
        status: run.status,
        inputTokens: run.inputTokens,
        cachedTokens: run.cachedTokens,
        outputTokens: run.outputTokens,
        latencyMs: run.latencyMs,
        errorCode: run.errorCode,
        completedAt: run.completedAt,
      })
      .where(
        and(
          eq(modelRuns.projectId, run.projectId),
          eq(modelRuns.id, run.id),
          eq(modelRuns.status, "running"),
        ),
      )
      .returning({ id: modelRuns.id });
    if (rows.length !== 1) {
      throw new DatabaseError(
        "WRITE_CONFLICT",
        "Model run was not found in the expected running state.",
      );
    }
  }

  public async findModelRun(
    projectId: ProjectId,
    runId: ModelRun["id"],
  ): Promise<ModelRun | null> {
    const rows = await this.session
      .select()
      .from(modelRuns)
      .where(and(eq(modelRuns.projectId, projectId), eq(modelRuns.id, runId)))
      .limit(1);
    return rows[0] === undefined ? null : modelRunFromRow(rows[0]);
  }

  public async listModelRuns(projectId: ProjectId): Promise<readonly ModelRun[]> {
    const rows = await this.session
      .select()
      .from(modelRuns)
      .where(eq(modelRuns.projectId, projectId))
      .orderBy(desc(modelRuns.createdAt), desc(modelRuns.id))
      .limit(200);
    return rows.map(modelRunFromRow);
  }

  public async insertAgentRun(untrustedRun: AgentRun): Promise<void> {
    const run = agentRunSchema.parse(untrustedRun);
    await this.session.insert(agentRuns).values({
      projectId: run.projectId,
      id: run.id,
      agentName: run.agentName,
      status: run.status,
      version: run.version,
      state: run.state,
      createdAt: run.createdAt,
      updatedAt: run.updatedAt,
    });
  }

  public async updateAgentRun(untrustedRun: AgentRun, expectedVersion: number): Promise<boolean> {
    const run = agentRunSchema.parse(untrustedRun);
    const rows = await this.session
      .update(agentRuns)
      .set({
        status: run.status,
        version: run.version,
        state: run.state,
        updatedAt: run.updatedAt,
      })
      .where(
        and(
          eq(agentRuns.projectId, run.projectId),
          eq(agentRuns.id, run.id),
          eq(agentRuns.version, expectedVersion),
        ),
      )
      .returning({ id: agentRuns.id });
    return rows.length === 1;
  }

  public async findAgentRun(projectId: ProjectId, runId: AgentRunId): Promise<AgentRun | null> {
    const rows = await this.session
      .select()
      .from(agentRuns)
      .where(and(eq(agentRuns.projectId, projectId), eq(agentRuns.id, runId)))
      .limit(1);
    return rows[0] === undefined ? null : agentRunFromRow(rows[0]);
  }

  public async listAgentRuns(projectId: ProjectId): Promise<readonly AgentRun[]> {
    const rows = await this.session
      .select()
      .from(agentRuns)
      .where(eq(agentRuns.projectId, projectId))
      .orderBy(desc(agentRuns.createdAt), desc(agentRuns.id))
      .limit(200);
    return rows.map(agentRunFromRow);
  }
}

export class PostgresAuditRepository implements AuditRepository {
  public constructor(private readonly session: DatabaseSession) {}

  public async append(untrustedEvent: AuditEvent): Promise<void> {
    const event = auditEventSchema.parse(untrustedEvent);
    await this.session.insert(auditEvents).values({
      projectId: event.projectId,
      id: event.id,
      actor: event.actor,
      action: event.action,
      targetType: event.targetType,
      targetId: event.targetId,
      metadata: event.metadata,
      occurredAt: event.occurredAt,
    });
  }

  public async list(projectId: ProjectId): Promise<readonly AuditEvent[]> {
    const rows = await this.session
      .select()
      .from(auditEvents)
      .where(eq(auditEvents.projectId, projectId))
      .orderBy(desc(auditEvents.occurredAt), desc(auditEvents.id))
      .limit(500);
    return rows.map(auditEventFromRow);
  }
}

export function createCceRepositories(session: DatabaseSession): CceRepositories {
  return {
    identity: new PostgresIdentityRepository(session),
    projects: new PostgresProjectRepository(session),
    conversations: new PostgresConversationRepository(session),
    context: new PostgresContextRepository(session),
    merges: new PostgresMergeRepository(session),
    runs: new PostgresRunRepository(session),
    audit: new PostgresAuditRepository(session),
  };
}
