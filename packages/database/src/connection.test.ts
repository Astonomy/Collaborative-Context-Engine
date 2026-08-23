import { describe, expect, it } from "vitest";

import { DatabaseError } from "./database-error";
import { normalizePostgresError } from "./connection";

describe("PostgreSQL error normalization", () => {
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
