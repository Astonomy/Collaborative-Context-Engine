import { jsonValueSchema } from "@cce/shared";
import { z } from "zod";

import { dateTimeSchema } from "./datetime";
import { agentRunIdSchema, conversationIdSchema, modelRunIdSchema, projectIdSchema } from "./ids";

export const modelRunStatusSchema = z.enum([
  "running",
  "completed",
  "failed",
  "interrupted",
]);

export const modelRunSchema = z
  .object({
    id: modelRunIdSchema,
    projectId: projectIdSchema,
    conversationId: conversationIdSchema.nullable(),
    provider: z.string().trim().min(1).max(100),
    model: z.string().trim().min(1).max(200),
    purpose: z.enum(["chat", "extraction", "classification", "agent"]),
    promptId: z.string().trim().min(1).max(100),
    promptVersion: z.int().positive().max(2_147_483_647),
    inputHash: z.string().regex(/^[a-f0-9]{64}$/),
    status: modelRunStatusSchema,
    inputTokens: z.int().nonnegative().max(2_147_483_647).nullable(),
    cachedTokens: z.int().nonnegative().max(2_147_483_647).nullable(),
    outputTokens: z.int().nonnegative().max(2_147_483_647).nullable(),
    latencyMs: z.int().nonnegative().max(2_147_483_647).nullable(),
    errorCode: z.string().trim().min(1).max(100).nullable(),
    createdAt: dateTimeSchema,
    completedAt: dateTimeSchema.nullable(),
  })
  .strict()
  .superRefine((run, context) => {
    const terminal = run.status !== "running";
    if (terminal !== (run.completedAt !== null)) {
      context.addIssue({
        code: "custom",
        message: "Terminal ModelRun status and completedAt must be set together.",
        path: ["completedAt"],
      });
    }
    if (
      run.status === "running" &&
      [run.inputTokens, run.cachedTokens, run.outputTokens, run.latencyMs, run.errorCode].some(
        (value) => value !== null,
      )
    ) {
      context.addIssue({
        code: "custom",
        message: "A running ModelRun cannot contain terminal metrics or an error.",
        path: ["status"],
      });
    }
    if (
      run.status === "completed" &&
      (run.inputTokens === null ||
        run.cachedTokens === null ||
        run.outputTokens === null ||
        run.latencyMs === null ||
        run.errorCode !== null ||
        run.provider === "pending")
    ) {
      context.addIssue({
        code: "custom",
        message:
          "A completed ModelRun requires a resolved provider, metrics, and cannot contain an error.",
        path: ["status"],
      });
    }
    if (
      ["failed", "interrupted"].includes(run.status) &&
      (run.errorCode === null || run.latencyMs === null)
    ) {
      context.addIssue({
        code: "custom",
        message: "A failed or interrupted ModelRun requires latency and an error code.",
        path: ["status"],
      });
    }
    if (
      run.cachedTokens !== null &&
      run.inputTokens !== null &&
      run.cachedTokens > run.inputTokens
    ) {
      context.addIssue({
        code: "custom",
        message: "Cached tokens cannot exceed input tokens.",
        path: ["cachedTokens"],
      });
    }
  });

export type ModelRun = z.infer<typeof modelRunSchema>;

export const agentRunStatusSchema = z.enum([
  "queued",
  "running",
  "awaiting_approval",
  "completed",
  "failed",
  "cancelled",
]);

export const agentRunSchema = z
  .object({
    id: agentRunIdSchema,
    projectId: projectIdSchema,
    agentName: z.enum(["manager", "extractor", "research", "review", "merge"]),
    status: agentRunStatusSchema,
    version: z.int().nonnegative().max(2_147_483_647),
    state: z.record(z.string(), jsonValueSchema),
    createdAt: dateTimeSchema,
    updatedAt: dateTimeSchema,
  })
  .strict();

export type AgentRun = z.infer<typeof agentRunSchema>;
