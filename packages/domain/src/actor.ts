import { z } from "zod";

import { agentRunIdSchema, modelRunIdSchema, userIdSchema } from "./ids";

const humanActorSchema = z
  .object({
    type: z.literal("human"),
    userId: userIdSchema,
  })
  .strict();

const agentActorSchema = z
  .object({
    type: z.literal("agent"),
    agentName: z.string().trim().min(1).max(100),
    runId: agentRunIdSchema,
  })
  .strict();

const modelActorSchema = z
  .object({
    type: z.literal("model"),
    provider: z.string().trim().min(1).max(100),
    model: z.string().trim().min(1).max(200),
    runId: modelRunIdSchema,
  })
  .strict();

const policyActorSchema = z
  .object({
    type: z.literal("policy"),
    policyId: z.string().trim().min(1).max(100),
    version: z.string().trim().min(1).max(50),
  })
  .strict();

export const actorSchema = z.discriminatedUnion("type", [
  humanActorSchema,
  agentActorSchema,
  modelActorSchema,
  policyActorSchema,
]);

export type Actor = z.infer<typeof actorSchema>;

