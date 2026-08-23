import { describe, expect, it } from "vitest";

import { rawApiTokenSchema } from "./api-token";

describe("raw API token boundary", () => {
  it("accepts the exact supported length boundaries", () => {
    expect(rawApiTokenSchema.safeParse("a".repeat(24)).success).toBe(true);
    expect(rawApiTokenSchema.safeParse("a".repeat(512)).success).toBe(true);
  });

  it("rejects unsupported lengths and never trims token identity", () => {
    expect(rawApiTokenSchema.safeParse("a".repeat(23)).success).toBe(false);
    expect(rawApiTokenSchema.safeParse("a".repeat(513)).success).toBe(false);
    expect(rawApiTokenSchema.parse(` ${"a".repeat(24)} `)).toBe(` ${"a".repeat(24)} `);
  });
});
