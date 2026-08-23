import { describe, expect, it } from "vitest";

import { sameContextSlot, scopeIdentity, scopesAreDisjoint } from "./scope";

describe("structured Context scope", () => {
  it("has a stable identity independent of tag order", () => {
    expect(scopeIdentity({ environment: "production", tags: ["b", "a"] })).toBe(
      scopeIdentity({ tags: ["a", "b"], environment: "production" }),
    );
    expect(
      scopeIdentity({ effectiveFrom: "2026-01-01T10:00:00+10:00", tags: [] }),
    ).toBe(scopeIdentity({ effectiveFrom: "2026-01-01T00:00:00Z", tags: [] }));
  });

  it("detects distinct dimensions and non-overlapping effective periods", () => {
    expect(
      scopesAreDisjoint(
        { environment: "development", tags: [] },
        { environment: "production", tags: [] },
      ),
    ).toBe(true);
    expect(
      scopesAreDisjoint(
        { effectiveTo: "2026-08-01T00:00:00.000Z", tags: [] },
        { effectiveFrom: "2026-08-01T00:00:00.000Z", tags: [] },
      ),
    ).toBe(true);
    expect(scopesAreDisjoint({ component: "api", tags: [] }, { tags: [] })).toBe(false);
    expect(
      scopesAreDisjoint(
        { effectiveTo: "2026-01-01T01:00:00Z", tags: [] },
        { effectiveFrom: "2026-01-01T10:30:00+10:00", tags: [] },
      ),
    ).toBe(false);
  });

  it("compares key, kind, and exact scope as a semantic slot", () => {
    const base = { key: "database.primary", kind: "decision" as const, scope: { tags: [] } };
    expect(sameContextSlot(base, { ...base })).toBe(true);
    expect(sameContextSlot(base, { ...base, key: "database.replica" })).toBe(false);
  });
});
