import { z } from "zod";

import { createPostgresPool } from "../connection";
import { runMigrations } from "../migrations";

const environmentSchema = z.object({ DATABASE_URL: z.string().min(1) });

async function migrate(): Promise<void> {
  const environment = environmentSchema.parse(process.env);
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
