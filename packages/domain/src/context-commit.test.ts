import { describe, expect, it } from "vitest";

import { contextCommitSchema } from "./context-commit";

const ids = {
  project: "00000000-0000-4000-8000-000000000001",
  otherProject: "00000000-0000-4000-8000-000000000002",
  commit: "00000000-0000-4000-8000-000000000003",
  parentCommit: "00000000-0000-4000-8000-000000000004",
  oldCommit: "00000000-0000-4000-8000-000000000005",
  delta: "00000000-0000-4000-8000-000000000006",
  deltaChange: "00000000-0000-4000-8000-000000000007",
  commitChange: "00000000-0000-4000-8000-000000000008",
  logicalItem: "00000000-0000-4000-8000-000000000009",
  beforeVersion: "00000000-0000-4000-8000-000000000010",
  afterVersion: "00000000-0000-4000-8000-000000000011",
  conversation: "00000000-0000-4000-8000-000000000012",
  message: "00000000-0000-4000-8000-000000000013",
  user: "00000000-0000-4000-8000-000000000014",
  secondCommitChange: "00000000-0000-4000-8000-000000000015",
  secondDeltaChange: "00000000-0000-4000-8000-000000000016",
  secondLogicalItem: "00000000-0000-4000-8000-000000000017",
  secondAfterVersion: "00000000-0000-4000-8000-000000000018",
} as const;

function itemVersion(
  id: string,
  commitId: string,
  previousVersionId: string | null,
  projectId: string = ids.project,
) {
  return {
    id,
    logicalItemId: ids.logicalItem,
    projectId,
    commitId,
    previousVersionId,
    kind: "fact",
    key: "database.primary",
    value: "PostgreSQL",
    scope: { tags: [] },
    authority: "authoritative",
    confidence: 1,
    provenance: [
      {
        projectId,
        conversationId: ids.conversation,
        messageIds: [ids.message],
        actor: { type: "human", userId: ids.user },
        modelRunId: null,
        recordedAt: "2026-08-23T00:00:00.000Z",
      },
    ],
    lifecycle: "active",
    scopeHash: "a".repeat(64),
    supersedesVersionId: null,
    createdAt: "2026-08-23T00:00:00.000Z",
  };
}

function semanticCommit(changeOverrides: Record<string, unknown> = {}) {
  const before = itemVersion(ids.beforeVersion, ids.oldCommit, null);
  const after = itemVersion(ids.afterVersion, ids.commit, ids.beforeVersion);
  return {
    id: ids.commit,
    projectId: ids.project,
    kind: "semantic",
    parentCommitId: ids.parentCommit,
    version: 2,
    idempotencyKey: "merge-request-1",
    summary: "Update primary database fact",
    sourceDeltaIds: [ids.delta],
    proposedBy: [{ type: "human", userId: ids.user }],
    committedBy: { type: "human", userId: ids.user },
    changes: [
      {
        id: ids.commitChange,
        ordinal: 0,
        operation: "update",
        logicalItemId: ids.logicalItem,
        beforeVersion: before,
        afterVersion: after,
        sourceDeltaId: ids.delta,
        sourceDeltaChangeId: ids.deltaChange,
        ...changeOverrides,
      },
    ],
    createdAt: "2026-08-23T00:00:00.000Z",
  };
}

describe("ContextCommit invariants", () => {
  it("accepts only the special empty version-zero genesis commit", () => {
    const genesis = {
      ...semanticCommit(),
      kind: "genesis",
      parentCommitId: null,
      version: 0,
      sourceDeltaIds: [],
      proposedBy: [],
      changes: [],
      summary: "Project genesis",
    };
    expect(contextCommitSchema.safeParse(genesis).success).toBe(true);
    expect(contextCommitSchema.safeParse({ ...genesis, version: 1 }).success).toBe(false);
  });

  it("rejects an empty semantic commit", () => {
    expect(contextCommitSchema.safeParse({ ...semanticCommit(), changes: [] }).success).toBe(false);
  });

  it("requires update versions to preserve lineage", () => {
    const unrelatedAfter = itemVersion(ids.afterVersion, ids.commit, null);
    const result = contextCommitSchema.safeParse(semanticCommit({ afterVersion: unrelatedAfter }));
    expect(result.success).toBe(false);
  });

  it("rejects a before version for an add operation", () => {
    expect(contextCommitSchema.safeParse(semanticCommit({ operation: "add" })).success).toBe(false);
  });

  it("rejects non-contiguous change ordinals", () => {
    expect(contextCommitSchema.safeParse(semanticCommit({ ordinal: 3 })).success).toBe(false);
  });

  it("rejects a ContextItem version from another project", () => {
    const after = itemVersion(ids.afterVersion, ids.commit, ids.beforeVersion, ids.otherProject);
    expect(contextCommitSchema.safeParse(semanticCommit({ afterVersion: after })).success).toBe(
      false,
    );
  });

  it("requires deprecation and supersession lifecycle relationships", () => {
    expect(contextCommitSchema.safeParse(semanticCommit({ operation: "deprecate" })).success).toBe(
      false,
    );
    expect(contextCommitSchema.safeParse(semanticCommit({ operation: "supersede" })).success).toBe(
      false,
    );
  });

  it("rejects two versions of the same logical lineage in one Commit", () => {
    const commit = semanticCommit();
    const first = commit.changes[0];
    if (first === undefined) {
      throw new Error("The semantic Commit fixture must contain one change.");
    }
    const second = {
      ...first,
      id: ids.secondCommitChange,
      ordinal: 1,
      sourceDeltaChangeId: ids.secondDeltaChange,
      afterVersion: { ...first.afterVersion, id: ids.secondAfterVersion },
    };
    expect(contextCommitSchema.safeParse({ ...commit, changes: [first, second] }).success).toBe(
      false,
    );
  });

  it("rejects competing authoritative values for the same slot in one Commit", () => {
    const commit = semanticCommit();
    const first = commit.changes[0];
    if (first === undefined) {
      throw new Error("The semantic Commit fixture must contain one change.");
    }
    const second = {
      ...first,
      id: ids.secondCommitChange,
      ordinal: 1,
      operation: "add",
      logicalItemId: ids.secondLogicalItem,
      beforeVersion: null,
      sourceDeltaChangeId: ids.secondDeltaChange,
      afterVersion: {
        ...first.afterVersion,
        id: ids.secondAfterVersion,
        logicalItemId: ids.secondLogicalItem,
        previousVersionId: null,
        value: "MySQL",
      },
    };
    expect(contextCommitSchema.safeParse({ ...commit, changes: [first, second] }).success).toBe(
      false,
    );
  });

  it("allows an authoritative slot to be deprecated and replaced by a new active lineage", () => {
    const commit = semanticCommit();
    const first = commit.changes[0];
    if (first === undefined) {
      throw new Error("The semantic Commit fixture must contain one change.");
    }
    const deprecated = {
      ...first,
      operation: "deprecate",
      afterVersion: { ...first.afterVersion, lifecycle: "deprecated" },
    };
    const replacement = {
      ...first,
      id: ids.secondCommitChange,
      ordinal: 1,
      operation: "add",
      logicalItemId: ids.secondLogicalItem,
      beforeVersion: null,
      sourceDeltaChangeId: ids.secondDeltaChange,
      afterVersion: {
        ...first.afterVersion,
        id: ids.secondAfterVersion,
        logicalItemId: ids.secondLogicalItem,
        previousVersionId: null,
        value: "CockroachDB",
      },
    };

    expect(
      contextCommitSchema.safeParse({ ...commit, changes: [deprecated, replacement] }).success,
    ).toBe(true);
  });
});
