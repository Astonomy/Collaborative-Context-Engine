import { describe, expect, it, vi } from "vitest";
import { DrizzleQueryError } from "drizzle-orm";

import { DatabaseError } from "./database-error";
import { createPostgresPool, normalizePostgresError, PostgresUnitOfWork } from "./connection";

it("reports connection failures as an unavailable database", async () => {
  const pool = createPostgresPool("postgresql://user:private-password@127.0.0.1:1/test", {
    connectionTimeoutMillis: 1000,
  });
  try {
    await expect(new PostgresUnitOfWork(pool).run(async () => undefined)).rejects.toMatchObject({
      name: "DatabaseError",
      code: "UNAVAILABLE",
    });
  } finally {
    await pool.end();
  }
});

it("handles idle pool errors without crashing or logging connection secrets", async () => {
  const report = vi.spyOn(console, "error").mockImplementation(() => undefined);
  const pool = createPostgresPool("postgresql://user:private-password@localhost/test");
  try {
    expect(() => pool.emit("error", new Error("private connection details"))).not.toThrow();
    expect(report).toHaveBeenCalledOnce();
    expect(JSON.stringify(report.mock.calls)).not.toContain("private");
  } finally {
    await pool.end();
    report.mockRestore();
  }
});

describe("PostgreSQL error normalization", () => {
  it("normalizes wrapped constraint errors without exposing attachment storage or evidence", () => {
    const cause = Object.assign(new Error("private storage conflict"), { code: "23505" });
    const wrapped = new DrizzleQueryError("insert attachment", ["private/key"], cause);
    expect(normalizePostgresError(wrapped)).toMatchObject({ code: "WRITE_CONFLICT" });
    expect((normalizePostgresError(wrapped) as Error).message).not.toContain("private");
    const unrelated = new DrizzleQueryError("select", [], new Error("network"));
    expect(normalizePostgresError(unrelated)).toBe(unrelated);
  });
  it.each(["23502", "23503", "23505", "23514", "23P01", "40001", "40P01", "55000"])(
    "maps SQLSTATE %s to a safe write conflict",
    (code) => {
      const original = Object.assign(new Error("sensitive constraint details"), { code });
      const mapped = normalizePostgresError(original);
      expect(mapped).toBeInstanceOf(DatabaseError);
      expect(mapped).toMatchObject({ code: "WRITE_CONFLICT" });
      expect((mapped as Error).message).not.toContain("sensitive");
    },
  );

  it("preserves explicit repository errors and unrelated failures", () => {
    const databaseError = new DatabaseError("NOT_FOUND", "missing");
    const unrelated = new Error("network");
    expect(normalizePostgresError(databaseError)).toBe(databaseError);
    expect(normalizePostgresError(unrelated)).toBe(unrelated);
  });
});
