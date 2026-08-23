import { agentRunSchema, auditEventSchema, modelRunSchema } from "@cce/domain";
import { z } from "zod";

export const projectAuditHistoryResponseSchema = z
  .object({
    modelRuns: z.array(modelRunSchema),
    agentRuns: z.array(agentRunSchema),
    events: z.array(auditEventSchema),
  })
  .strict();

export type ProjectAuditHistoryResponse = z.infer<
  typeof projectAuditHistoryResponseSchema
>;
