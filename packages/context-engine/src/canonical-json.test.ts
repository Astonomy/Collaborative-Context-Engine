import { describe, expect, it } from "vitest";

import {
  canonicalizeJson,
  mergeCompatibleJson,
  normalizedJsonEquals,
  stableStringify,
} from "./canonical-json";

describe("canonical JSON comparison", () => {
  it("sorts object keys recursively without changing array order", () => {
    expect(canonicalizeJson({ z: 1, a: { y: 2, b: 3 }, list: [2, 1] })).toEqual({
      a: { b: 3, y: 2 },
      list: [2, 1],
      z: 1,
    });
    expect(stableStringify({ b: 2, a: 1 })).toBe('{"a":1,"b":2}');
  });

  it("keeps case, whitespace, and array ordering as semantic data", () => {
    expect(normalizedJsonEquals(" PostgreSQL ", "postgresql")).toBe(false);
    expect(normalizedJsonEquals("PostgreSQL", "PostgreSQL")).toBe(true);
    expect(normalizedJsonEquals(["Docker", "Postgres"], ["Postgres", "Docker"])).toBe(
      false,
    );
  });

  it("keeps ordered arrays exact and merges non-overlapping objects deterministically", () => {
    expect(mergeCompatibleJson(["PostgreSQL"], ["postgresql", "pgvector"])).toEqual({
      compatible: false,
    });
    expect(mergeCompatibleJson(["PostgreSQL"], ["PostgreSQL"])).toEqual({
      compatible: true,
      value: ["PostgreSQL"],
    });
    expect(
      mergeCompatibleJson({ database: "PostgreSQL" }, { extension: "pgvector" }),
    ).toEqual({
      compatible: true,
      value: { database: "PostgreSQL", extension: "pgvector" },
    });
  });

  it("rejects conflicting object fields and incompatible scalar expansion", () => {
    expect(mergeCompatibleJson({ database: "PostgreSQL" }, { database: "MySQL" })).toEqual({
      compatible: false,
    });
    expect(mergeCompatibleJson("PostgreSQL", "MySQL")).toEqual({ compatible: false });
  });
});
