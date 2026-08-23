import { z } from "zod";

/** Opaque API tokens are byte-for-byte identities; surrounding whitespace is significant. */
export const rawApiTokenSchema = z.string().min(24).max(512);

export type RawApiToken = z.infer<typeof rawApiTokenSchema>;
