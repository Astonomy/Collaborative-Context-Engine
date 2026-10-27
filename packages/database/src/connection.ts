import type { CceRepositories, UnitOfWork } from "@cce/application";
import { drizzle } from "drizzle-orm/node-postgres";
import { DrizzleQueryError } from "drizzle-orm";
import { Pool, type PoolConfig } from "pg";
import { z } from "zod";

import { createCceRepositories } from "./repositories";
import { databaseSchema } from "./schema";
import { DatabaseError } from "./database-error";
import type { AttachmentRepository } from "@cce/application";
import { createAttachmentRepository } from "./attachment-repository";

const postgresUrlSchema = z
  .url()
  .refine((value) => value.startsWith("postgresql://") || value.startsWith("postgres://"), {
    message: "DATABASE_URL must use the postgresql:// or postgres:// scheme.",
  });

export function createPostgresPool(
  databaseUrl: string,
  options: Omit<PoolConfig, "connectionString"> = {},
): Pool {
  const pool = new Pool({ ...options, connectionString: postgresUrlSchema.parse(databaseUrl) });
  // pg removes failed idle clients itself. Handle its error event so a database
  // restart does not terminate the API; later requests can open fresh connections.
  pool.on("error", () => {
    console.error("PostgreSQL idle connection failed; the pool will replace it.");
  });
  return pool;
}

export class PostgresUnitOfWork implements UnitOfWork {
  public constructor(private readonly pool: Pool) {}

  public async run<T>(operation: (repositories: CceRepositories) => Promise<T>): Promise<T> {
    return this.runWithAttachments(operation);
  }

  public async runWithAttachments<T>(
    operation: (
      repositories: CceRepositories & { readonly attachments: AttachmentRepository },
    ) => Promise<T>,
  ): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SET CONSTRAINTS ALL DEFERRED");
      const session = drizzle(client, { schema: databaseSchema });
      const result = await operation({
        ...createCceRepositories(session),
        attachments: createAttachmentRepository(session),
      });
      await client.query("COMMIT");
      return result;
    } catch (error: unknown) {
      try {
        await client.query("ROLLBACK");
      } catch (rollbackError: unknown) {
        throw new AggregateError(
          [error, rollbackError],
          "Database transaction and rollback both failed.",
        );
      }
      throw normalizePostgresError(error);
    } finally {
      client.release();
    }
  }
}

const writeConflictSqlStates = new Set([
  "23502",
  "23503",
  "23505",
  "23514",
  "23P01",
  "40001",
  "40P01",
  "55000",
]);

export function normalizePostgresError(error: unknown): unknown {
  if (error instanceof DatabaseError) return error;
  if (error instanceof DrizzleQueryError) {
    const normalized = normalizePostgresError(error.cause);
    return normalized instanceof DatabaseError ? normalized : error;
  }
  if (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    typeof error.code === "string" &&
    writeConflictSqlStates.has(error.code)
  ) {
    return new DatabaseError(
      "WRITE_CONFLICT",
      "The requested write conflicts with persisted database constraints.",
      { cause: error },
    );
  }
  return error;
}
