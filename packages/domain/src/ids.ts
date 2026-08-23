import { z } from "zod";

const uuid = z.uuid();

export const userIdSchema = uuid.brand<"UserId">();
export const projectIdSchema = uuid.brand<"ProjectId">();
export const conversationIdSchema = uuid.brand<"ConversationId">();
export const branchIdSchema = uuid.brand<"BranchId">();
export const messageIdSchema = uuid.brand<"MessageId">();
export const contextItemVersionIdSchema = uuid.brand<"ContextItemVersionId">();
export const logicalContextItemIdSchema = uuid.brand<"LogicalContextItemId">();
export const contextDeltaIdSchema = uuid.brand<"ContextDeltaId">();
export const deltaChangeIdSchema = uuid.brand<"DeltaChangeId">();
export const contextCommitIdSchema = uuid.brand<"ContextCommitId">();
export const commitChangeIdSchema = uuid.brand<"CommitChangeId">();
export const mergeRequestIdSchema = uuid.brand<"MergeRequestId">();
export const mergeConflictIdSchema = uuid.brand<"MergeConflictId">();
export const auditEventIdSchema = uuid.brand<"AuditEventId">();
export const modelRunIdSchema = uuid.brand<"ModelRunId">();
export const agentRunIdSchema = uuid.brand<"AgentRunId">();

export type UserId = z.infer<typeof userIdSchema>;
export type ProjectId = z.infer<typeof projectIdSchema>;
export type ConversationId = z.infer<typeof conversationIdSchema>;
export type BranchId = z.infer<typeof branchIdSchema>;
export type MessageId = z.infer<typeof messageIdSchema>;
export type ContextItemVersionId = z.infer<typeof contextItemVersionIdSchema>;
export type LogicalContextItemId = z.infer<typeof logicalContextItemIdSchema>;
export type ContextDeltaId = z.infer<typeof contextDeltaIdSchema>;
export type DeltaChangeId = z.infer<typeof deltaChangeIdSchema>;
export type ContextCommitId = z.infer<typeof contextCommitIdSchema>;
export type CommitChangeId = z.infer<typeof commitChangeIdSchema>;
export type MergeRequestId = z.infer<typeof mergeRequestIdSchema>;
export type MergeConflictId = z.infer<typeof mergeConflictIdSchema>;
export type AuditEventId = z.infer<typeof auditEventIdSchema>;
export type ModelRunId = z.infer<typeof modelRunIdSchema>;
export type AgentRunId = z.infer<typeof agentRunIdSchema>;

