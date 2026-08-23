import type { CceRepositories, UnitOfWork } from "@cce/application";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool, type PoolConfig } from "pg";
import { z } from "zod";

import { createCceRepositories } from "./repositories";
import { databaseSchema } from "./schema";
import { DatabaseError } from "./database-error";

const postgresUrlSchema = z
  .url()
  .refine((value) => value.startsWith("postgresql://") || value.startsWith("postgres://"), {
    message: "DATABASE_URL must use the postgresql:// or postgres:// scheme.",
  });

export function createPostgresPool(
  databaseUrl: string,
  options: Omit<PoolConfig, "connectionString"> = {},
): Pool {
  return new Pool({ ...options, connectionString: postgresUrlSchema.parse(databaseUrl) });
}

export class PostgresUnitOfWork implements UnitOfWork {
  public constructor(private readonly pool: Pool) {}

  public async run<T>(operation: (repositories: CceRepositories) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SET CONSTRAINTS ALL DEFERRED");
      const session = drizzle(client, { schema: databaseSchema });
      const result = await operation(createCceRepositories(session));
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
