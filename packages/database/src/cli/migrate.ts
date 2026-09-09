import { createPostgresPool } from "../connection";
import { runMigrations } from "../migrations";
import { parseMigrationEnvironment } from "./environment";

async function migrate(): Promise<void> {
  const environment = parseMigrationEnvironment(process.env);
  const pool = createPostgresPool(environment.DATABASE_URL);
  try {
    const results = await runMigrations(pool);
    for (const result of results) {
      console.log(`${result.name}: ${result.status}`);
    }
  } finally {
    await pool.end();
  }
}

try {
  await migrate();
} catch (error: unknown) {
  console.error(error instanceof Error ? error.message : "Database migration failed.");
  process.exitCode = 1;
}
