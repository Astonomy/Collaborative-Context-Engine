import { describe, expect, it } from "vitest";

import { contextDeltaSchema } from "./context-delta";

const ids = {
  delta: "00000000-0000-4000-8000-000000000001",
  project: "00000000-0000-4000-8000-000000000002",
  otherProject: "00000000-0000-4000-8000-000000000003",
  branch: "00000000-0000-4000-8000-000000000004",
  conversation: "00000000-0000-4000-8000-000000000005",
  otherConversation: "00000000-0000-4000-8000-000000000006",
  baseCommit: "00000000-0000-4000-8000-000000000007",
  user: "00000000-0000-4000-8000-000000000008",
  message: "00000000-0000-4000-8000-000000000009",
  change: "00000000-0000-4000-8000-000000000010",
  secondChange: "00000000-0000-4000-8000-000000000013",
  logicalItem: "00000000-0000-4000-8000-000000000011",
  version: "00000000-0000-4000-8000-000000000012",
} as const;

function source(projectId: string = ids.project, conversationId: string = ids.conversation) {
  return {
    projectId,
    conversationId,
    messageIds: [ids.message],
    actor: { type: "human", userId: ids.user },
    modelRunId: null,
    recordedAt: "2026-08-23T00:00:00.000Z",
  };
}

function proposal(projectId: string = ids.project, conversationId: string = ids.conversation) {
  return {
    kind: "fact",
    key: "database.primary",
    value: "PostgreSQL",
    scope: { tags: [] },
    authority: "authoritative",
    confidence: 0.9,
    provenance: [source(projectId, conversationId)],
    explicitSupersedesVersionId: null,
  };
}

function delta(changes: readonly unknown[]) {
  return {
    id: ids.delta,
    projectId: ids.project,
    branchId: ids.branch,
    conversationId: ids.conversation,
    baseCommitId: ids.baseCommit,
    throughMessageSequence: 2,
    schemaVersion: 1,
    extractorRunId: null,
    revisionOf: null,
    contentHash: "a".repeat(64),
    proposedBy: { type: "human", userId: ids.user },
    createdAt: "2026-08-23T00:00:00.000Z",
    changes,
  };
}

describe("ContextDelta invariants", () => {
  it("accepts an empty Delta as a valid identity proposal", () => {
    const result = contextDeltaSchema.parse(delta([]));
    expect(result.changes).toEqual([]);
  });

  it("rejects duplicate change IDs", () => {
    const change = { id: ids.change, operation: "add", proposal: proposal() };
    expect(contextDeltaSchema.safeParse(delta([change, change])).success).toBe(false);
  });

  it("rejects cross-project and cross-conversation provenance", () => {
    const change = {
      id: ids.change,
      operation: "add",
      proposal: proposal(ids.otherProject, ids.otherConversation),
    };
    const result = contextDeltaSchema.safeParse(delta([change]));
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.map((issue) => issue.message)).toEqual(
        expect.arrayContaining([
          "Delta provenance must belong to the Delta project.",
          "Delta provenance must belong to the Delta conversation.",
        ]),
      );
    }
  });

  it("requires explicit replacement intent for supersession", () => {
    const change = {
      id: ids.change,
      operation: "supersede",
      targetLogicalItemId: ids.logicalItem,
      expectedBaseVersionId: ids.version,
      proposal: proposal(),
    };
    expect(contextDeltaSchema.safeParse(delta([change])).success).toBe(false);
  });

  it("requires target IDs for update and rejects unknown fields", () => {
    const malformed = {
      id: ids.change,
      operation: "update",
      proposal: proposal(),
      silentlyAccepted: true,
    };
    expect(contextDeltaSchema.safeParse(delta([malformed])).success).toBe(false);
  });

  it("accepts a well-formed deprecation with evidence", () => {
    const change = {
      id: ids.change,
      operation: "deprecate",
      targetLogicalItemId: ids.logicalItem,
      expectedBaseVersionId: ids.version,
      provenance: [source()],
    };
    expect(contextDeltaSchema.safeParse(delta([change])).success).toBe(true);
  });

  it("rejects multiple changes to the same logical lineage", () => {
    const first = {
      id: ids.change,
      operation: "update",
      targetLogicalItemId: ids.logicalItem,
      expectedBaseVersionId: ids.version,
      proposal: proposal(),
    };
    const second = {
      id: ids.secondChange,
      operation: "deprecate",
      targetLogicalItemId: ids.logicalItem,
      expectedBaseVersionId: ids.version,
      provenance: [source()],
    };
    expect(contextDeltaSchema.safeParse(delta([first, second])).success).toBe(false);
  });

  it("rejects competing authoritative proposals for one semantic slot", () => {
    const first = { id: ids.change, operation: "add", proposal: proposal() };
    const second = {
      id: ids.secondChange,
      operation: "add",
      proposal: { ...proposal(), value: "MySQL" },
    };
    expect(contextDeltaSchema.safeParse(delta([first, second])).success).toBe(false);
  });
});
