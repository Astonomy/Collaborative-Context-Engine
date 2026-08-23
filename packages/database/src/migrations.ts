import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

import type { Pool } from "pg";

import { DatabaseError } from "./database-error";

interface MigrationDefinition {
  readonly name: string;
  readonly resource: URL;
}

interface AppliedMigrationRow {
  readonly name: string;
  readonly checksum: string;
}

export interface MigrationResult {
  readonly name: string;
  readonly status: "applied" | "already_applied";
}

const migrations: readonly MigrationDefinition[] = [
  {
    name: "0001_initial.sql",
    resource: new URL("../migrations/0001_initial.sql", import.meta.url),
  },
];

function migrationChecksum(contents: string): string {
  return createHash("sha256").update(contents, "utf8").digest("hex");
}

export async function runMigrations(pool: Pool): Promise<readonly MigrationResult[]> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(
      "SELECT pg_advisory_xact_lock(hashtextextended('cce-schema-migrations', 0))",
    );
    await client.query(`
      CREATE TABLE IF NOT EXISTS cce_schema_migrations (
        name text PRIMARY KEY,
        checksum char(64) NOT NULL,
        applied_at timestamptz NOT NULL DEFAULT clock_timestamp(),
        CONSTRAINT cce_schema_migrations_checksum_sha256
          CHECK (checksum ~ '^[a-f0-9]{64}$')
      )
    `);

    const results: MigrationResult[] = [];
    for (const migration of migrations) {
      const contents = await readFile(migration.resource, "utf8");
      const checksum = migrationChecksum(contents);
      const applied = await client.query<AppliedMigrationRow>(
        "SELECT name, checksum FROM cce_schema_migrations WHERE name = $1",
        [migration.name],
      );
      const existing = applied.rows[0];
      if (existing !== undefined) {
        if (existing.checksum.trim() !== checksum) {
          throw new DatabaseError(
            "WRITE_CONFLICT",
            `Applied migration ${migration.name} no longer matches its recorded checksum.`,
          );
        }
        results.push({ name: migration.name, status: "already_applied" });
        continue;
      }

      await client.query(contents);
      await client.query("INSERT INTO cce_schema_migrations (name, checksum) VALUES ($1, $2)", [
        migration.name,
        checksum,
      ]);
      results.push({ name: migration.name, status: "applied" });
    }
    await client.query("COMMIT");
    return results;
  } catch (error: unknown) {
    try {
      await client.query("ROLLBACK");
    } catch (rollbackError: unknown) {
      throw new AggregateError([error, rollbackError], "Migration and rollback both failed.");
    }
    throw error;
  } finally {
    client.release();
  }
}
