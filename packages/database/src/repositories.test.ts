import { describe, expect, it } from "vitest";
import { z } from "zod";

import { DatabaseError } from "./database-error";
import { parsePersisted } from "./repositories";

describe("persisted record validation", () => {
  it("returns a validated persisted record", () => {
    expect(parsePersisted(z.object({ version: z.int().nonnegative() }), { version: 2 }, "record"))
      .toEqual({ version: 2 });
  });

  it("reports corrupt storage without leaking validator internals", () => {
    let thrown: unknown;
    try {
      parsePersisted(z.object({ secret: z.string().min(20) }), { secret: "short" }, "credential");
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(DatabaseError);
    expect(thrown).toMatchObject({
      code: "CORRUPT_DATA",
      message: "Persisted credential is invalid.",
    });
    expect(String(thrown)).not.toContain("secret");
  });
});
