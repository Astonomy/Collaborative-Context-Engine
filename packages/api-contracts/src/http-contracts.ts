import { z } from "zod";

export const apiErrorCodeSchema = z.enum([
  "UNAUTHENTICATED",
  "FORBIDDEN",
  "NOT_FOUND",
  "CONFLICT",
  "VALIDATION",
  "UNPROCESSABLE_ENTITY",
  "RATE_LIMITED",
  "DEPENDENCY_UNAVAILABLE",
  "INTERNAL_ERROR",
]);

export const apiErrorResponseSchema = z
  .object({
    error: z
      .object({
        code: apiErrorCodeSchema,
        message: z.string().trim().min(1).max(500),
        details: z.record(z.string(), z.string()).default({}),
      })
      .strict(),
  })
  .strict();

export const emptyRequestBodySchema = z.object({}).strict();

export type ApiErrorResponse = z.infer<typeof apiErrorResponseSchema>;
