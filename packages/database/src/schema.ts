import { sql } from "drizzle-orm";
import {
  boolean,
  char,
  check,
  doublePrecision,
  foreignKey,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import type { PgTimestampStringBuilderInitial } from "drizzle-orm/pg-core";

export const projectRoleEnum = pgEnum("project_role", ["owner", "editor", "viewer"]);
export const conversationStatusEnum = pgEnum("conversation_status", ["active", "archived"]);
export const branchStatusEnum = pgEnum("branch_status", ["open", "merged", "abandoned"]);
export const messageRoleEnum = pgEnum("message_role", ["system", "user", "assistant", "tool"]);
export const messageDeliveryStateEnum = pgEnum("message_delivery_state", [
  "pending",
  "streaming",
  "completed",
  "interrupted",
  "failed",
]);
export const contextCommitKindEnum = pgEnum("context_commit_kind", ["genesis", "semantic"]);
export const contextOperationEnum = pgEnum("context_operation", [
  "add",
  "update",
  "supersede",
  "deprecate",
]);
export const contextItemKindEnum = pgEnum("context_item_kind", [
  "fact",
  "decision",
  "requirement",
  "assumption",
  "constraint",
  "task",
  "question",
  "risk",
  "artifact",
  "preference",
  "rejected_option",
  "architecture",
]);
export const contextItemLifecycleEnum = pgEnum("context_item_lifecycle", [
  "active",
  "deprecated",
  "superseded",
]);
export const contextItemAuthorityEnum = pgEnum("context_item_authority", [
  "authoritative",
  "alternative",
]);
export const conflictClassificationEnum = pgEnum("conflict_classification", [
  "duplicate",
  "C0",
  "C1",
  "C2",
  "C3",
  "C4",
]);
export const mergeRequestStatusEnum = pgEnum("merge_request_status", [
  "draft",
  "reviewing",
  "ready",
  "committed",
  "rejected",
  "stale",
]);
export const mergeFinalizationOutcomeEnum = pgEnum("merge_finalization_outcome", [
  "committed",
  "no_changes",
]);
export const modelRunStatusEnum = pgEnum("model_run_status", [
  "running",
  "completed",
  "failed",
  "interrupted",
]);
export const modelRunPurposeEnum = pgEnum("model_run_purpose", [
  "chat",
  "extraction",
  "classification",
  "agent",
]);
export const agentRunStatusEnum = pgEnum("agent_run_status", [
  "queued",
  "running",
  "awaiting_approval",
  "completed",
  "failed",
  "cancelled",
]);
export const agentNameEnum = pgEnum("agent_name", [
  "manager",
  "extractor",
  "research",
  "review",
  "merge",
]);

const auditTimestamp = <Name extends string>(name: Name): PgTimestampStringBuilderInitial<Name> =>
  timestamp(name, { withTimezone: true, mode: "string" });

export const users = pgTable(
  "users",
  {
    id: uuid("id").primaryKey(),
    email: text("email").notNull(),
    displayName: text("display_name").notNull(),
    createdAt: auditTimestamp("created_at").notNull(),
  },
  (table) => [
    uniqueIndex("users_email_normalized_uq").on(sql`lower(${table.email})`),
    check("users_email_not_blank", sql`length(btrim(${table.email})) > 0`),
    check("users_display_name_not_blank", sql`length(btrim(${table.displayName})) > 0`),
  ],
);

export const apiTokens = pgTable(
  "api_tokens",
  {
    tokenHash: char("token_hash", { length: 64 }).primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    label: text("label").notNull(),
    createdAt: auditTimestamp("created_at").notNull(),
  },
  (table) => [
    index("api_tokens_user_idx").on(table.userId),
    check("api_tokens_hash_sha256", sql`${table.tokenHash} ~ '^[a-f0-9]{64}$'`),
    check("api_tokens_label_not_blank", sql`length(btrim(${table.label})) > 0`),
  ],
);

export const projects = pgTable(
  "projects",
  {
    projectId: uuid("project_id").primaryKey(),
    name: text("name").notNull(),
    headCommitId: uuid("head_commit_id").notNull(),
    version: integer("version").notNull(),
    createdBy: uuid("created_by")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    createdAt: auditTimestamp("created_at").notNull(),
    archivedAt: auditTimestamp("archived_at"),
  },
  (table) => [
    check("projects_name_not_blank", sql`length(btrim(${table.name})) > 0`),
    check("projects_version_nonnegative", sql`${table.version} >= 0`),
  ],
);

export const projectMembers = pgTable(
  "project_members",
  {
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.projectId, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    role: projectRoleEnum("role").notNull(),
    joinedAt: auditTimestamp("joined_at").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.projectId, table.userId], name: "project_members_pk" }),
    index("project_members_user_idx").on(table.userId, table.projectId),
  ],
);

export const contextCommits = pgTable(
  "context_commits",
  {
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.projectId, { onDelete: "restrict" }),
    id: uuid("id").notNull(),
    kind: contextCommitKindEnum("kind").notNull(),
    parentCommitId: uuid("parent_commit_id"),
    version: integer("version").notNull(),
    idempotencyKey: text("idempotency_key").notNull(),
    summary: text("summary").notNull(),
    proposedBy: jsonb("proposed_by").$type<unknown>().notNull(),
    committedBy: jsonb("committed_by").$type<unknown>().notNull(),
    createdAt: auditTimestamp("created_at").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.projectId, table.id], name: "context_commits_pk" }),
    unique("context_commits_project_version_uq").on(table.projectId, table.version),
    unique("context_commits_idempotency_uq").on(table.projectId, table.idempotencyKey),
    foreignKey({
      columns: [table.projectId, table.parentCommitId],
      foreignColumns: [table.projectId, table.id],
      name: "context_commits_parent_fk",
    }).onDelete("restrict"),
    check("context_commits_version_nonnegative", sql`${table.version} >= 0`),
    check("context_commits_idempotency_not_blank", sql`length(btrim(${table.idempotencyKey})) > 0`),
    check("context_commits_summary_not_blank", sql`length(btrim(${table.summary})) > 0`),
  ],
);

export const conversations = pgTable(
  "conversations",
  {
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.projectId, { onDelete: "restrict" }),
    id: uuid("id").notNull(),
    branchId: uuid("branch_id").notNull(),
    title: text("title").notNull(),
    status: conversationStatusEnum("status").notNull(),
    createdBy: jsonb("created_by").$type<unknown>().notNull(),
    createdAt: auditTimestamp("created_at").notNull(),
    archivedAt: auditTimestamp("archived_at"),
  },
  (table) => [
    primaryKey({ columns: [table.projectId, table.id], name: "conversations_pk" }),
    unique("conversations_project_branch_uq").on(table.projectId, table.branchId),
    check("conversations_title_not_blank", sql`length(btrim(${table.title})) > 0`),
  ],
);

export const branches = pgTable(
  "branches",
  {
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.projectId, { onDelete: "restrict" }),
    id: uuid("id").notNull(),
    conversationId: uuid("conversation_id").notNull(),
    baseCommitId: uuid("base_commit_id").notNull(),
    status: branchStatusEnum("status").notNull(),
    createdAt: auditTimestamp("created_at").notNull(),
    closedAt: auditTimestamp("closed_at"),
  },
  (table) => [
    primaryKey({ columns: [table.projectId, table.id], name: "branches_pk" }),
    unique("branches_project_conversation_uq").on(table.projectId, table.conversationId),
    unique("branches_project_id_conversation_uq").on(
      table.projectId,
      table.id,
      table.conversationId,
    ),
    unique("branches_project_id_conversation_base_uq").on(
      table.projectId,
      table.id,
      table.conversationId,
      table.baseCommitId,
    ),
    foreignKey({
      columns: [table.projectId, table.conversationId],
      foreignColumns: [conversations.projectId, conversations.id],
      name: "branches_conversation_fk",
    }).onDelete("restrict"),
    foreignKey({
      columns: [table.projectId, table.baseCommitId],
      foreignColumns: [contextCommits.projectId, contextCommits.id],
      name: "branches_base_commit_fk",
    }).onDelete("restrict"),
  ],
);

export const messages = pgTable(
  "messages",
  {
    projectId: uuid("project_id").notNull(),
    id: uuid("id").notNull(),
    conversationId: uuid("conversation_id").notNull(),
    sequence: integer("sequence").notNull(),
    clientMessageId: uuid("client_message_id"),
    replyToMessageId: uuid("reply_to_message_id"),
    role: messageRoleEnum("role").notNull(),
    deliveryState: messageDeliveryStateEnum("delivery_state").notNull(),
    content: text("content").notNull(),
    author: jsonb("author").$type<unknown>().notNull(),
    providerMessageId: text("provider_message_id"),
    errorCode: text("error_code"),
    createdAt: auditTimestamp("created_at").notNull(),
    completedAt: auditTimestamp("completed_at"),
  },
  (table) => [
    primaryKey({ columns: [table.projectId, table.id], name: "messages_pk" }),
    unique("messages_project_conversation_id_uq").on(
      table.projectId,
      table.conversationId,
      table.id,
    ),
    unique("messages_sequence_uq").on(table.projectId, table.conversationId, table.sequence),
    unique("messages_client_id_uq").on(
      table.projectId,
      table.conversationId,
      table.clientMessageId,
    ),
    uniqueIndex("messages_reply_to_message_uq")
      .on(table.projectId, table.conversationId, table.replyToMessageId)
      .where(sql`${table.replyToMessageId} IS NOT NULL`),
    foreignKey({
      columns: [table.projectId, table.conversationId],
      foreignColumns: [conversations.projectId, conversations.id],
      name: "messages_conversation_fk",
    }).onDelete("restrict"),
    foreignKey({
      columns: [table.projectId, table.conversationId, table.replyToMessageId],
      foreignColumns: [table.projectId, table.conversationId, table.id],
      name: "messages_reply_to_message_fk",
    }).onDelete("restrict"),
    check("messages_sequence_positive", sql`${table.sequence} > 0`),
    check(
      "messages_reply_role",
      sql`${table.replyToMessageId} IS NULL OR ${table.role} = 'assistant'`,
    ),
  ],
);

export const conversationImports = pgTable(
  "conversation_imports",
  {
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.projectId, { onDelete: "restrict" }),
    id: uuid("id").notNull(),
    source: text("source").notNull(),
    sourceFormat: text("source_format").notNull(),
    sourceFileHash: char("source_file_hash", { length: 64 }).notNull(),
    policy: text("policy").notNull(),
    status: text("status").notNull(),
    createdBy: uuid("created_by")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    createdAt: auditTimestamp("created_at").notNull(),
    completedAt: auditTimestamp("completed_at").notNull(),
    conversationCount: integer("conversation_count").notNull(),
    messageCount: integer("message_count").notNull(),
    warnings: jsonb("warnings").$type<unknown>().notNull(),
    sourceManifest: jsonb("source_manifest").$type<unknown>().notNull(),
    importedConversations: jsonb("imported_conversations").$type<unknown>().notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.projectId, table.id], name: "conversation_imports_pk" }),
    unique("conversation_imports_identity_uq").on(
      table.projectId,
      table.sourceFileHash,
      table.policy,
    ),
    check("conversation_imports_hash_format", sql`${table.sourceFileHash} ~ '^[0-9a-f]{64}$'`),
    check(
      "conversation_imports_counts_nonnegative",
      sql`${table.conversationCount} >= 0 AND ${table.messageCount} >= 0`,
    ),
    check(
      "conversation_imports_source",
      sql`${table.source} IN ('chatgpt', 'chatgpt-plugin', 'codex-plugin')`,
    ),
    check(
      "conversation_imports_source_format",
      sql`${table.sourceFormat} IN ('json', 'zip', 'mcp')`,
    ),
    check(
      "conversation_imports_policy",
      sql`${table.policy} IN ('current_path', 'provided_messages')`,
    ),
    check(
      "conversation_imports_source_shape",
      sql`(
        (${table.source} = 'chatgpt' AND ${table.sourceFormat} IN ('json', 'zip') AND ${table.policy} = 'current_path')
        OR
        (${table.source} IN ('chatgpt-plugin', 'codex-plugin') AND ${table.sourceFormat} = 'mcp' AND ${table.policy} = 'provided_messages')
      )`,
    ),
    check("conversation_imports_completed_status", sql`${table.status} = 'completed'`),
    check(
      "conversation_imports_json_shape",
      sql`jsonb_typeof(${table.warnings}) = 'array'
        AND jsonb_typeof(${table.sourceManifest}) = 'array'
        AND jsonb_typeof(${table.importedConversations}) = 'array'`,
    ),
  ],
);

export const conversationImportPreviews = pgTable(
  "conversation_import_previews",
  {
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.projectId, { onDelete: "restrict" }),
    id: uuid("id").notNull(),
    source: text("source").notNull(),
    sourceFileHash: char("source_file_hash", { length: 64 }).notNull(),
    createdBy: uuid("created_by")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    createdAt: auditTimestamp("created_at").notNull(),
    expiresAt: auditTimestamp("expires_at").notNull(),
    messageCount: integer("message_count").notNull(),
    unsupportedContentCount: integer("unsupported_content_count").notNull(),
    warnings: jsonb("warnings").$type<unknown>().notNull(),
    conversation: jsonb("conversation").$type<unknown>().notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.projectId, table.id], name: "conversation_import_previews_pk" }),
    index("conversation_import_previews_expiry_idx").on(table.expiresAt),
    check(
      "conversation_import_previews_source",
      sql`${table.source} IN ('chatgpt-plugin', 'codex-plugin')`,
    ),
    check(
      "conversation_import_previews_hash_format",
      sql`${table.sourceFileHash} ~ '^[0-9a-f]{64}$'`,
    ),
    check(
      "conversation_import_previews_counts_nonnegative",
      sql`${table.messageCount} >= 0 AND ${table.unsupportedContentCount} >= 0`,
    ),
    check(
      "conversation_import_previews_expiry_after_creation",
      sql`${table.expiresAt} > ${table.createdAt}`,
    ),
    check(
      "conversation_import_previews_json_shape",
      sql`jsonb_typeof(${table.warnings}) = 'array'
        AND jsonb_typeof(${table.conversation}) = 'object'`,
    ),
  ],
);

export const modelRuns = pgTable(
  "model_runs",
  {
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.projectId, { onDelete: "restrict" }),
    id: uuid("id").notNull(),
    conversationId: uuid("conversation_id"),
    provider: text("provider").notNull(),
    model: text("model").notNull(),
    purpose: modelRunPurposeEnum("purpose").notNull(),
    promptId: text("prompt_id").notNull(),
    promptVersion: integer("prompt_version").notNull(),
    inputHash: char("input_hash", { length: 64 }).notNull(),
    status: modelRunStatusEnum("status").notNull(),
    inputTokens: integer("input_tokens"),
    cachedTokens: integer("cached_tokens"),
    outputTokens: integer("output_tokens"),
    latencyMs: integer("latency_ms"),
    errorCode: text("error_code"),
    createdAt: auditTimestamp("created_at").notNull(),
    completedAt: auditTimestamp("completed_at"),
  },
  (table) => [
    primaryKey({ columns: [table.projectId, table.id], name: "model_runs_pk" }),
    foreignKey({
      columns: [table.projectId, table.conversationId],
      foreignColumns: [conversations.projectId, conversations.id],
      name: "model_runs_conversation_fk",
    }).onDelete("restrict"),
    check("model_runs_prompt_version_positive", sql`${table.promptVersion} > 0`),
    check("model_runs_input_hash_sha256", sql`${table.inputHash} ~ '^[a-f0-9]{64}$'`),
    check(
      "model_runs_cached_tokens_lte_input",
      sql`${table.cachedTokens} IS NULL OR ${table.inputTokens} IS NULL OR ${table.cachedTokens} <= ${table.inputTokens}`,
    ),
    check(
      "model_runs_state_shape",
      sql`(
        (${table.status} = 'running' AND ${table.completedAt} IS NULL AND ${table.errorCode} IS NULL
          AND ${table.inputTokens} IS NULL AND ${table.cachedTokens} IS NULL
          AND ${table.outputTokens} IS NULL AND ${table.latencyMs} IS NULL)
        OR
        (${table.status} = 'completed' AND ${table.provider} <> 'pending'
          AND ${table.completedAt} IS NOT NULL
          AND ${table.errorCode} IS NULL AND ${table.inputTokens} IS NOT NULL
          AND ${table.cachedTokens} IS NOT NULL AND ${table.outputTokens} IS NOT NULL
          AND ${table.latencyMs} IS NOT NULL)
        OR
        (${table.status} IN ('failed', 'interrupted') AND ${table.completedAt} IS NOT NULL
          AND ${table.errorCode} IS NOT NULL AND ${table.latencyMs} IS NOT NULL)
      )`,
    ),
  ],
);

export const agentRuns = pgTable(
  "agent_runs",
  {
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.projectId, { onDelete: "restrict" }),
    id: uuid("id").notNull(),
    agentName: agentNameEnum("agent_name").notNull(),
    status: agentRunStatusEnum("status").notNull(),
    version: integer("version").notNull(),
    state: jsonb("state").$type<unknown>().notNull(),
    createdAt: auditTimestamp("created_at").notNull(),
    updatedAt: auditTimestamp("updated_at").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.projectId, table.id], name: "agent_runs_pk" }),
    check("agent_runs_version_nonnegative", sql`${table.version} >= 0`),
  ],
);

export const contextDeltas = pgTable(
  "context_deltas",
  {
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.projectId, { onDelete: "restrict" }),
    id: uuid("id").notNull(),
    branchId: uuid("branch_id").notNull(),
    conversationId: uuid("conversation_id").notNull(),
    baseCommitId: uuid("base_commit_id").notNull(),
    throughMessageSequence: integer("through_message_sequence").notNull(),
    schemaVersion: integer("schema_version").notNull(),
    extractorRunId: uuid("extractor_run_id"),
    revisionOf: uuid("revision_of"),
    contentHash: char("content_hash", { length: 64 }).notNull(),
    proposedBy: jsonb("proposed_by").$type<unknown>().notNull(),
    createdAt: auditTimestamp("created_at").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.projectId, table.id], name: "context_deltas_pk" }),
    unique("context_deltas_project_conversation_id_uq").on(
      table.projectId,
      table.conversationId,
      table.id,
    ),
    unique("context_deltas_request_scope_uq").on(
      table.projectId,
      table.id,
      table.branchId,
      table.baseCommitId,
    ),
    foreignKey({
      columns: [table.projectId, table.branchId, table.conversationId, table.baseCommitId],
      foreignColumns: [
        branches.projectId,
        branches.id,
        branches.conversationId,
        branches.baseCommitId,
      ],
      name: "context_deltas_branch_fk",
    }).onDelete("restrict"),
    foreignKey({
      columns: [table.projectId, table.conversationId],
      foreignColumns: [conversations.projectId, conversations.id],
      name: "context_deltas_conversation_fk",
    }).onDelete("restrict"),
    foreignKey({
      columns: [table.projectId, table.baseCommitId],
      foreignColumns: [contextCommits.projectId, contextCommits.id],
      name: "context_deltas_base_commit_fk",
    }).onDelete("restrict"),
    foreignKey({
      columns: [table.projectId, table.extractorRunId],
      foreignColumns: [modelRuns.projectId, modelRuns.id],
      name: "context_deltas_extractor_run_fk",
    }).onDelete("restrict"),
    foreignKey({
      columns: [table.projectId, table.revisionOf],
      foreignColumns: [table.projectId, table.id],
      name: "context_deltas_revision_fk",
    }).onDelete("restrict"),
    check("context_deltas_sequence_nonnegative", sql`${table.throughMessageSequence} >= 0`),
    check("context_deltas_schema_version_one", sql`${table.schemaVersion} = 1`),
    check("context_deltas_content_hash_sha256", sql`${table.contentHash} ~ '^[a-f0-9]{64}$'`),
  ],
);

export const contextDeltaChanges = pgTable(
  "context_delta_changes",
  {
    projectId: uuid("project_id").notNull(),
    deltaId: uuid("delta_id").notNull(),
    id: uuid("id").notNull(),
    ordinal: integer("ordinal").notNull(),
    operation: contextOperationEnum("operation").notNull(),
    payload: jsonb("payload").$type<unknown>().notNull(),
  },
  (table) => [
    primaryKey({
      columns: [table.projectId, table.deltaId, table.id],
      name: "context_delta_changes_pk",
    }),
    unique("context_delta_changes_ordinal_uq").on(table.projectId, table.deltaId, table.ordinal),
    foreignKey({
      columns: [table.projectId, table.deltaId],
      foreignColumns: [contextDeltas.projectId, contextDeltas.id],
      name: "context_delta_changes_delta_fk",
    }).onDelete("restrict"),
    check("context_delta_changes_ordinal_nonnegative", sql`${table.ordinal} >= 0`),
  ],
);

export const contextItemVersions = pgTable(
  "context_item_versions",
  {
    projectId: uuid("project_id").notNull(),
    id: uuid("id").notNull(),
    logicalItemId: uuid("logical_item_id").notNull(),
    commitId: uuid("commit_id").notNull(),
    previousVersionId: uuid("previous_version_id"),
    kind: contextItemKindEnum("kind").notNull(),
    key: text("key").notNull(),
    value: jsonb("value").$type<unknown>().notNull(),
    scope: jsonb("scope").$type<unknown>().notNull(),
    authority: contextItemAuthorityEnum("authority").notNull(),
    confidence: doublePrecision("confidence").notNull(),
    lifecycle: contextItemLifecycleEnum("lifecycle").notNull(),
    scopeHash: char("scope_hash", { length: 64 }).notNull(),
    supersedesVersionId: uuid("supersedes_version_id"),
    createdAt: auditTimestamp("created_at").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.projectId, table.id], name: "context_item_versions_pk" }),
    unique("context_item_versions_project_commit_id_uq").on(
      table.projectId,
      table.commitId,
      table.id,
    ),
    unique("context_item_versions_lineage_id_uq").on(
      table.projectId,
      table.logicalItemId,
      table.id,
    ),
    unique("context_item_versions_commit_lineage_id_uq").on(
      table.projectId,
      table.commitId,
      table.logicalItemId,
      table.id,
    ),
    unique("context_item_versions_commit_lineage_uq").on(
      table.projectId,
      table.commitId,
      table.logicalItemId,
    ),
    uniqueIndex("context_item_versions_commit_authoritative_slot_uq")
      .on(table.projectId, table.commitId, table.kind, table.key, table.scopeHash)
      .where(sql`${table.authority} = 'authoritative' AND ${table.lifecycle} = 'active'`),
    foreignKey({
      columns: [table.projectId, table.commitId],
      foreignColumns: [contextCommits.projectId, contextCommits.id],
      name: "context_item_versions_commit_fk",
    }).onDelete("restrict"),
    foreignKey({
      columns: [table.projectId, table.logicalItemId, table.previousVersionId],
      foreignColumns: [table.projectId, table.logicalItemId, table.id],
      name: "context_item_versions_previous_fk",
    }).onDelete("restrict"),
    foreignKey({
      columns: [table.projectId, table.logicalItemId, table.supersedesVersionId],
      foreignColumns: [table.projectId, table.logicalItemId, table.id],
      name: "context_item_versions_supersedes_fk",
    }).onDelete("restrict"),
    check(
      "context_item_versions_key_normalized",
      sql`${table.key} ~ '^[a-z0-9]+([._-][a-z0-9]+)*$'`,
    ),
    check("context_item_versions_confidence_range", sql`${table.confidence} BETWEEN 0 AND 1`),
    check("context_item_versions_scope_hash_sha256", sql`${table.scopeHash} ~ '^[a-f0-9]{64}$'`),
  ],
);

export const contextItemProvenance = pgTable(
  "context_item_provenance",
  {
    projectId: uuid("project_id").notNull(),
    contextItemVersionId: uuid("context_item_version_id").notNull(),
    ordinal: integer("ordinal").notNull(),
    conversationId: uuid("conversation_id").notNull(),
    actor: jsonb("actor").$type<unknown>().notNull(),
    modelRunId: uuid("model_run_id"),
    recordedAt: auditTimestamp("recorded_at").notNull(),
  },
  (table) => [
    primaryKey({
      columns: [table.projectId, table.contextItemVersionId, table.ordinal],
      name: "context_item_provenance_pk",
    }),
    foreignKey({
      columns: [table.projectId, table.contextItemVersionId],
      foreignColumns: [contextItemVersions.projectId, contextItemVersions.id],
      name: "context_item_provenance_version_fk",
    }).onDelete("restrict"),
    foreignKey({
      columns: [table.projectId, table.conversationId],
      foreignColumns: [conversations.projectId, conversations.id],
      name: "context_item_provenance_conversation_fk",
    }).onDelete("restrict"),
    foreignKey({
      columns: [table.projectId, table.modelRunId],
      foreignColumns: [modelRuns.projectId, modelRuns.id],
      name: "context_item_provenance_model_run_fk",
    }).onDelete("restrict"),
    check("context_item_provenance_ordinal_nonnegative", sql`${table.ordinal} >= 0`),
  ],
);

export const contextItemProvenanceMessages = pgTable(
  "context_item_provenance_messages",
  {
    projectId: uuid("project_id").notNull(),
    contextItemVersionId: uuid("context_item_version_id").notNull(),
    provenanceOrdinal: integer("provenance_ordinal").notNull(),
    messageOrdinal: integer("message_ordinal").notNull(),
    conversationId: uuid("conversation_id").notNull(),
    messageId: uuid("message_id").notNull(),
  },
  (table) => [
    primaryKey({
      columns: [
        table.projectId,
        table.contextItemVersionId,
        table.provenanceOrdinal,
        table.messageOrdinal,
      ],
      name: "context_item_provenance_messages_pk",
    }),
    unique("context_item_provenance_message_uq").on(
      table.projectId,
      table.contextItemVersionId,
      table.provenanceOrdinal,
      table.messageId,
    ),
    foreignKey({
      columns: [table.projectId, table.contextItemVersionId, table.provenanceOrdinal],
      foreignColumns: [
        contextItemProvenance.projectId,
        contextItemProvenance.contextItemVersionId,
        contextItemProvenance.ordinal,
      ],
      name: "context_item_provenance_messages_source_fk",
    }).onDelete("restrict"),
    foreignKey({
      columns: [table.projectId, table.conversationId, table.messageId],
      foreignColumns: [messages.projectId, messages.conversationId, messages.id],
      name: "context_item_provenance_messages_message_fk",
    }).onDelete("restrict"),
    check(
      "context_item_provenance_messages_ordinal_nonnegative",
      sql`${table.messageOrdinal} >= 0`,
    ),
  ],
);

export const contextCommitSources = pgTable(
  "context_commit_sources",
  {
    projectId: uuid("project_id").notNull(),
    commitId: uuid("commit_id").notNull(),
    ordinal: integer("ordinal").notNull(),
    deltaId: uuid("delta_id").notNull(),
  },
  (table) => [
    primaryKey({
      columns: [table.projectId, table.commitId, table.ordinal],
      name: "context_commit_sources_pk",
    }),
    unique("context_commit_sources_delta_uq").on(table.projectId, table.commitId, table.deltaId),
    foreignKey({
      columns: [table.projectId, table.commitId],
      foreignColumns: [contextCommits.projectId, contextCommits.id],
      name: "context_commit_sources_commit_fk",
    }).onDelete("restrict"),
    foreignKey({
      columns: [table.projectId, table.deltaId],
      foreignColumns: [contextDeltas.projectId, contextDeltas.id],
      name: "context_commit_sources_delta_fk",
    }).onDelete("restrict"),
    check("context_commit_sources_ordinal_nonnegative", sql`${table.ordinal} >= 0`),
  ],
);

export const contextCommitChanges = pgTable(
  "context_commit_changes",
  {
    projectId: uuid("project_id").notNull(),
    commitId: uuid("commit_id").notNull(),
    id: uuid("id").notNull(),
    ordinal: integer("ordinal").notNull(),
    operation: contextOperationEnum("operation").notNull(),
    logicalItemId: uuid("logical_item_id").notNull(),
    beforeVersionId: uuid("before_version_id"),
    afterVersionId: uuid("after_version_id").notNull(),
    sourceDeltaId: uuid("source_delta_id").notNull(),
    sourceDeltaChangeId: uuid("source_delta_change_id").notNull(),
  },
  (table) => [
    primaryKey({
      columns: [table.projectId, table.commitId, table.id],
      name: "context_commit_changes_pk",
    }),
    unique("context_commit_changes_ordinal_uq").on(table.projectId, table.commitId, table.ordinal),
    foreignKey({
      columns: [table.projectId, table.commitId],
      foreignColumns: [contextCommits.projectId, contextCommits.id],
      name: "context_commit_changes_commit_fk",
    }).onDelete("restrict"),
    foreignKey({
      columns: [table.projectId, table.commitId, table.logicalItemId, table.afterVersionId],
      foreignColumns: [
        contextItemVersions.projectId,
        contextItemVersions.commitId,
        contextItemVersions.logicalItemId,
        contextItemVersions.id,
      ],
      name: "context_commit_changes_after_version_fk",
    }).onDelete("restrict"),
    foreignKey({
      columns: [table.projectId, table.logicalItemId, table.beforeVersionId],
      foreignColumns: [
        contextItemVersions.projectId,
        contextItemVersions.logicalItemId,
        contextItemVersions.id,
      ],
      name: "context_commit_changes_before_version_fk",
    }).onDelete("restrict"),
    foreignKey({
      columns: [table.projectId, table.sourceDeltaId, table.sourceDeltaChangeId],
      foreignColumns: [
        contextDeltaChanges.projectId,
        contextDeltaChanges.deltaId,
        contextDeltaChanges.id,
      ],
      name: "context_commit_changes_delta_change_fk",
    }).onDelete("restrict"),
    check("context_commit_changes_ordinal_nonnegative", sql`${table.ordinal} >= 0`),
  ],
);

export const currentContextItems = pgTable(
  "current_context_items",
  {
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.projectId, { onDelete: "restrict" }),
    logicalItemId: uuid("logical_item_id").notNull(),
    versionId: uuid("version_id").notNull(),
  },
  (table) => [
    primaryKey({
      columns: [table.projectId, table.logicalItemId],
      name: "current_context_items_pk",
    }),
    unique("current_context_items_version_uq").on(table.projectId, table.versionId),
    foreignKey({
      columns: [table.projectId, table.logicalItemId, table.versionId],
      foreignColumns: [
        contextItemVersions.projectId,
        contextItemVersions.logicalItemId,
        contextItemVersions.id,
      ],
      name: "current_context_items_version_fk",
    }).onDelete("restrict"),
  ],
);

export const mergeRequests = pgTable(
  "merge_requests",
  {
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.projectId, { onDelete: "restrict" }),
    id: uuid("id").notNull(),
    branchId: uuid("branch_id").notNull(),
    deltaId: uuid("delta_id").notNull(),
    baseCommitId: uuid("base_commit_id").notNull(),
    evaluatedHeadCommitId: uuid("evaluated_head_commit_id").notNull(),
    resultingCommitId: uuid("resulting_commit_id"),
    status: mergeRequestStatusEnum("status").notNull(),
    createdBy: jsonb("created_by").$type<unknown>().notNull(),
    createdAt: auditTimestamp("created_at").notNull(),
    updatedAt: auditTimestamp("updated_at").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.projectId, table.id], name: "merge_requests_pk" }),
    unique("merge_requests_project_id_delta_uq").on(table.projectId, table.id, table.deltaId),
    foreignKey({
      columns: [table.projectId, table.branchId],
      foreignColumns: [branches.projectId, branches.id],
      name: "merge_requests_branch_fk",
    }).onDelete("restrict"),
    foreignKey({
      columns: [table.projectId, table.deltaId],
      foreignColumns: [contextDeltas.projectId, contextDeltas.id],
      name: "merge_requests_delta_fk",
    }).onDelete("restrict"),
    foreignKey({
      columns: [table.projectId, table.deltaId, table.branchId, table.baseCommitId],
      foreignColumns: [
        contextDeltas.projectId,
        contextDeltas.id,
        contextDeltas.branchId,
        contextDeltas.baseCommitId,
      ],
      name: "merge_requests_delta_scope_fk",
    }).onDelete("restrict"),
    foreignKey({
      columns: [table.projectId, table.baseCommitId],
      foreignColumns: [contextCommits.projectId, contextCommits.id],
      name: "merge_requests_base_commit_fk",
    }).onDelete("restrict"),
    foreignKey({
      columns: [table.projectId, table.evaluatedHeadCommitId],
      foreignColumns: [contextCommits.projectId, contextCommits.id],
      name: "merge_requests_head_commit_fk",
    }).onDelete("restrict"),
    foreignKey({
      columns: [table.projectId, table.resultingCommitId],
      foreignColumns: [contextCommits.projectId, contextCommits.id],
      name: "merge_requests_result_commit_fk",
    }).onDelete("restrict"),
  ],
);

export const mergeFinalizations = pgTable(
  "merge_finalizations",
  {
    projectId: uuid("project_id").notNull(),
    mergeRequestId: uuid("merge_request_id").notNull(),
    operationKey: text("operation_key").notNull(),
    outcome: mergeFinalizationOutcomeEnum("outcome").notNull(),
    resultingCommitId: uuid("resulting_commit_id"),
    finalizedAt: auditTimestamp("finalized_at").notNull(),
  },
  (table) => [
    primaryKey({
      columns: [table.projectId, table.mergeRequestId],
      name: "merge_finalizations_pk",
    }),
    unique("merge_finalizations_operation_key_uq").on(table.projectId, table.operationKey),
    foreignKey({
      columns: [table.projectId, table.mergeRequestId],
      foreignColumns: [mergeRequests.projectId, mergeRequests.id],
      name: "merge_finalizations_request_fk",
    }).onDelete("restrict"),
    foreignKey({
      columns: [table.projectId, table.resultingCommitId],
      foreignColumns: [contextCommits.projectId, contextCommits.id],
      name: "merge_finalizations_result_commit_fk",
    }).onDelete("restrict"),
    check(
      "merge_finalizations_result_shape",
      sql`(${table.outcome} = 'committed' AND ${table.resultingCommitId} IS NOT NULL) OR (${table.outcome} = 'no_changes' AND ${table.resultingCommitId} IS NULL)`,
    ),
    check(
      "merge_finalizations_operation_key_not_blank",
      sql`length(btrim(${table.operationKey})) > 0`,
    ),
    check("merge_finalizations_operation_key_length", sql`length(${table.operationKey}) <= 200`),
  ],
);

export const mergeConflicts = pgTable(
  "merge_conflicts",
  {
    projectId: uuid("project_id").notNull(),
    id: uuid("id").notNull(),
    mergeRequestId: uuid("merge_request_id").notNull(),
    deltaId: uuid("delta_id").notNull(),
    deltaChangeId: uuid("delta_change_id").notNull(),
    classification: conflictClassificationEnum("classification").notNull(),
    baseVersion: jsonb("base_version").$type<unknown>(),
    currentVersion: jsonb("current_version").$type<unknown>(),
    proposed: jsonb("proposed").$type<unknown>(),
    reason: text("reason").notNull(),
    requiresHumanReview: boolean("requires_human_review").notNull(),
    resolution: jsonb("resolution").$type<unknown>(),
    createdAt: auditTimestamp("created_at").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.projectId, table.id], name: "merge_conflicts_pk" }),
    foreignKey({
      columns: [table.projectId, table.mergeRequestId, table.deltaId],
      foreignColumns: [mergeRequests.projectId, mergeRequests.id, mergeRequests.deltaId],
      name: "merge_conflicts_request_fk",
    }).onDelete("restrict"),
    foreignKey({
      columns: [table.projectId, table.deltaId, table.deltaChangeId],
      foreignColumns: [
        contextDeltaChanges.projectId,
        contextDeltaChanges.deltaId,
        contextDeltaChanges.id,
      ],
      name: "merge_conflicts_delta_change_fk",
    }).onDelete("restrict"),
    check("merge_conflicts_reason_not_blank", sql`length(btrim(${table.reason})) > 0`),
  ],
);

export const auditEvents = pgTable(
  "audit_events",
  {
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.projectId, { onDelete: "restrict" }),
    id: uuid("id").notNull(),
    actor: jsonb("actor").$type<unknown>().notNull(),
    action: text("action").notNull(),
    targetType: text("target_type").notNull(),
    targetId: uuid("target_id").notNull(),
    metadata: jsonb("metadata").$type<unknown>().notNull(),
    occurredAt: auditTimestamp("occurred_at").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.projectId, table.id], name: "audit_events_pk" }),
    index("audit_events_project_time_idx").on(table.projectId, table.occurredAt),
    check("audit_events_action_not_blank", sql`length(btrim(${table.action})) > 0`),
    check("audit_events_target_type_not_blank", sql`length(btrim(${table.targetType})) > 0`),
  ],
);

export const databaseSchema = {
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
};

export type DatabaseSchema = typeof databaseSchema;
