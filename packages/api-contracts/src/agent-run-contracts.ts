import {
  agentRunIdSchema,
  agentRunSchema,
  agentRunStatusSchema,
  contextDeltaSchema,
  conversationIdSchema,
  projectIdSchema,
} from "@cce/domain";
import { z } from "zod";

export const agentRunPathParamsSchema = z
  .object({
    projectId: projectIdSchema,
    runId: agentRunIdSchema,
  })
  .strict();

export const createAgentRunBodySchema = z
  .object({
    conversationId: conversationIdSchema,
    throughMessageSequence: z.int().nonnegative().max(2_147_483_647),
    objective: z.string().trim().min(1).max(4_000),
  })
  .strict();

export const listAgentRunsQuerySchema = z
  .object({
    status: agentRunStatusSchema.optional(),
  })
  .strict();

export const resumeAgentRunBodySchema = z
  .object({
    decision: z.enum(["approve", "reject"]),
    rationale: z.string().trim().min(1).max(2_000),
  })
  .strict();

export const cancelAgentRunBodySchema = z
  .object({
    rationale: z.string().trim().min(1).max(2_000),
  })
  .strict();

export const reconcileAgentRunBodySchema = z.object({}).strict();

export const agentRunResponseSchema = z
  .object({
    run: agentRunSchema,
    proposal: contextDeltaSchema.nullable(),
  })
  .strict();

export const agentRunListResponseSchema = z.array(agentRunSchema);

export type AgentRunPathParams = z.infer<typeof agentRunPathParamsSchema>;
export type CreateAgentRunBody = z.infer<typeof createAgentRunBodySchema>;
export type ListAgentRunsQuery = z.infer<typeof listAgentRunsQuerySchema>;
export type ResumeAgentRunBody = z.infer<typeof resumeAgentRunBodySchema>;
export type CancelAgentRunBody = z.infer<typeof cancelAgentRunBodySchema>;
export type ReconcileAgentRunBody = z.infer<typeof reconcileAgentRunBodySchema>;
export type AgentRunResponse = z.infer<typeof agentRunResponseSchema>;
