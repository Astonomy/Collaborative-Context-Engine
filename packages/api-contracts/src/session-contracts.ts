import { userSchema } from "@cce/domain";
import { rawApiTokenSchema } from "@cce/shared";
import { z } from "zod";

export const createSessionBodySchema = z
  .object({
    apiToken: rawApiTokenSchema,
  })
  .strict();

export const sessionResponseSchema = z
  .object({
    user: userSchema,
  })
  .strict();

export const deleteSessionResponseSchema = z.object({ success: z.literal(true) }).strict();

export type CreateSessionBody = z.infer<typeof createSessionBodySchema>;
export type SessionResponse = z.infer<typeof sessionResponseSchema>;
