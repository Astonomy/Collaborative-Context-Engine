import { createHash } from "node:crypto";

import { rawApiTokenSchema } from "@cce/shared";

export function hashApiToken(untrustedToken: string): string {
  const token = rawApiTokenSchema.parse(untrustedToken);
  return createHash("sha256").update(token, "utf8").digest("hex");
}
