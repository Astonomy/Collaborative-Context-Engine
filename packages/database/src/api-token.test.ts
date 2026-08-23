import { describe, expect, it } from "vitest";

import { hashApiToken } from "./api-token";

describe("API token hashing", () => {
  it("returns a deterministic lowercase SHA-256 digest without retaining the token", () => {
    const token = "correct-horse-battery-staple";
    const first = hashApiToken(token);
    expect(first).toMatch(/^[a-f0-9]{64}$/);
    expect(first).toBe(hashApiToken(token));
    expect(first).not.toContain(token);
  });

  it("rejects tokens too short to be development credentials", () => {
    expect(() => hashApiToken("short-token")).toThrow();
  });
});
