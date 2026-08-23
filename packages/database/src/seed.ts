import { randomUUID } from "node:crypto";

import type { UnitOfWork } from "@cce/application";
import { userSchema, type User } from "@cce/domain";
import { rawApiTokenSchema } from "@cce/shared";
import { z } from "zod";

import { hashApiToken } from "./api-token";
import { DatabaseError } from "./database-error";

const seedInputSchema = z
  .object({
    email: z.email().max(320),
    displayName: z.string().trim().min(1).max(120),
    apiToken: rawApiTokenSchema,
    tokenLabel: z.string().trim().min(1).max(160).default("development-bootstrap"),
  })
  .strict();

export interface SeedInput {
  readonly email: string;
  readonly displayName: string;
  readonly apiToken: string;
  readonly tokenLabel?: string;
}

export interface SeedResult {
  readonly user: User;
  readonly userCreated: boolean;
  readonly tokenCreated: boolean;
}

export async function seedDevelopmentIdentity(
  unitOfWork: UnitOfWork,
  untrustedInput: SeedInput,
): Promise<SeedResult> {
  const input = seedInputSchema.parse(untrustedInput);
  const tokenHash = hashApiToken(input.apiToken);
  return unitOfWork.run(async (repositories) => {
    let user = await repositories.identity.findUserByEmail(input.email);
    const userCreated = user === null;
    if (user === null) {
      user = userSchema.parse({
        id: randomUUID(),
        email: input.email,
        displayName: input.displayName,
        createdAt: new Date().toISOString(),
      });
      await repositories.identity.insertUser(user);
    }

    const tokenOwner = await repositories.identity.findUserByApiTokenHash(tokenHash);
    if (tokenOwner !== null && tokenOwner.id !== user.id) {
      throw new DatabaseError("WRITE_CONFLICT", "The seed API token belongs to another user.");
    }
    const tokenCreated = tokenOwner === null;
    if (tokenCreated) {
      await repositories.identity.insertApiToken({
        userId: user.id,
        tokenHash,
        label: input.tokenLabel,
        createdAt: new Date().toISOString(),
      });
    }
    return { user, userCreated, tokenCreated };
  });
}
