import { createPostgresPool, PostgresUnitOfWork } from "../connection";
import { runMigrations } from "../migrations";
import { seedDevelopmentIdentity } from "../seed";
import { parseSeedEnvironment } from "./environment";

async function seed(): Promise<void> {
  const environment = parseSeedEnvironment(process.env);
  const pool = createPostgresPool(environment.DATABASE_URL);
  try {
    await runMigrations(pool);
    const result = await seedDevelopmentIdentity(new PostgresUnitOfWork(pool), {
      email: environment.CCE_SEED_USER_EMAIL,
      displayName: environment.CCE_SEED_USER_NAME,
      apiToken: environment.CCE_SEED_API_TOKEN,
    });
    console.log(
      `Seed identity ready (user ${result.userCreated ? "created" : "existing"}, token ${result.tokenCreated ? "created" : "existing"}).`,
    );
  } finally {
    await pool.end();
  }
}

try {
  await seed();
} catch (error: unknown) {
  console.error(error instanceof Error ? error.message : "Database seed failed.");
  process.exitCode = 1;
}
