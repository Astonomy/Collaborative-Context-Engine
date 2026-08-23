import { describe, expect, it } from "vitest";

import type { DatabaseError } from "./database-error";
import { databaseTimestamp, nullableDatabaseTimestamp, requireRecord } from "./database-values";

describe("database value validation", () => {
  it("normalizes PostgreSQL timestamps before domain parsing", () => {
    expect(databaseTimestamp("2026-08-23 01:02:03+08")).toBe("2026-08-22T17:02:03.000Z");
    expect(nullableDatabaseTimestamp(null)).toBeNull();
  });

  it("rejects invalid persisted timestamps as corrupt data", () => {
    expect(() => databaseTimestamp("not-a-timestamp")).toThrowError(
      expect.objectContaining<Partial<DatabaseError>>({ code: "CORRUPT_DATA" }),
    );
  });

  it("rejects a dangling persisted relationship", () => {
    expect(() => requireRecord(new Map<string, string>(), "missing", "Commit")).toThrow(
      "Commit missing is missing.",
    );
  });
});
