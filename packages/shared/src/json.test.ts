import { describe, expect, it } from "vitest";

import {
  contextValueSchema,
  maximumContextValueBytes,
  maximumContextValueDepth,
} from "./json";

describe("bounded Context JSON", () => {
  it("accepts ordinary JSON values", () => {
    expect(contextValueSchema.parse({ database: "PostgreSQL", replicas: [1, 2] })).toEqual({
      database: "PostgreSQL",
      replicas: [1, 2],
    });
  });

  it("rejects excessive serialized size and depth before recursive parsing", () => {
    expect(contextValueSchema.safeParse("x".repeat(maximumContextValueBytes)).success).toBe(
      false,
    );
    let nested: unknown = "leaf";
    for (let index = 0; index <= maximumContextValueDepth; index += 1) {
      nested = { child: nested };
    }
    expect(contextValueSchema.safeParse(nested).success).toBe(false);
  });
});
