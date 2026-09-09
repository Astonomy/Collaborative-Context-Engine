import { rawApiTokenSchema } from "@cce/shared";
import { z } from "zod";

const migrationEnvironmentSchema = z.object({ DATABASE_URL: z.string().min(1) });

const seedEnvironmentSchema = migrationEnvironmentSchema.extend({
  CCE_SEED_USER_EMAIL: z.email().max(320),
  CCE_SEED_USER_NAME: z.string().trim().min(1).max(120),
  CCE_SEED_API_TOKEN: rawApiTokenSchema,
});

type MigrationEnvironment = z.infer<typeof migrationEnvironmentSchema>;
type SeedEnvironment = z.infer<typeof seedEnvironmentSchema>;

export function parseMigrationEnvironment(environment: NodeJS.ProcessEnv): MigrationEnvironment {
  return migrationEnvironmentSchema.parse(environment);
}

export function parseSeedEnvironment(environment: NodeJS.ProcessEnv): SeedEnvironment {
  return seedEnvironmentSchema.parse(environment);
}
