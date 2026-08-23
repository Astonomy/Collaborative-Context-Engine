import {
  contextDeltaSchema,
  contextDeltaChangeSchema,
  contextItemProposalSchema,
  contextItemVersionSchema,
  contextCommitIdSchema,
  contextDeltaIdSchema,
  projectIdSchema,
  type ContextDeltaChange,
  type ContextItemProposal,
  type ContextItemVersion,
} from "@cce/domain";
import { describe, expect, it } from "vitest";

import type { ContextSnapshot } from "./merge-types";
import { createThreeWayMergePlan } from "./three-way-merge";

const ids = {
  project: "00000000-0000-4000-8000-000000000001",
  otherProject: "00000000-0000-4000-8000-000000000002",
  baseCommit: "00000000-0000-4000-8000-000000000003",
  headCommit: "00000000-0000-4000-8000-000000000004",
  branch: "00000000-0000-4000-8000-000000000005",
  conversation: "00000000-0000-4000-8000-000000000006",
  message: "00000000-0000-4000-8000-000000000007",
  user: "00000000-0000-4000-8000-000000000008",
  delta: "00000000-0000-4000-8000-000000000009",
  change: "00000000-0000-4000-8000-000000000010",
  logical: "00000000-0000-4000-8000-000000000011",
  baseVersion: "00000000-0000-4000-8000-000000000012",
  currentVersion: "00000000-0000-4000-8000-000000000013",
} as const;

interface ItemOptions {
  readonly id?: string;
  readonly logicalItemId?: string;
  readonly commitId?: string;
  readonly key?: string;
  readonly kind?: ContextItemVersion["kind"];
  readonly value?: ContextItemVersion["value"];
  readonly scope?: ContextItemVersion["scope"];
  readonly lifecycle?: ContextItemVersion["lifecycle"];
  readonly projectId?: string;
  readonly previousVersionId?: string | null;
}

function item(options: ItemOptions = {}): ContextItemVersion {
  const projectId = options.projectId ?? ids.project;
  return contextItemVersionSchema.parse({
    id: options.id ?? ids.baseVersion,
    logicalItemId: options.logicalItemId ?? ids.logical,
    projectId,
    commitId: options.commitId ?? ids.baseCommit,
    previousVersionId: options.previousVersionId ?? null,
    kind: options.kind ?? "fact",
    key: options.key ?? "database.primary",
    value: options.value ?? "PostgreSQL",
    scope: options.scope ?? { tags: [] },
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
    lifecycle: options.lifecycle ?? "active",
    scopeHash: "a".repeat(64),
    supersedesVersionId: null,
    createdAt: "2026-08-23T00:00:00.000Z",
  });
}

interface ProposalOptions {
  readonly key?: string;
  readonly kind?: ContextItemProposal["kind"];
  readonly value?: ContextItemProposal["value"];
  readonly scope?: ContextItemProposal["scope"];
  readonly explicitSupersedesVersionId?: string | null;
}

function proposal(options: ProposalOptions = {}): ContextItemProposal {
  return contextItemProposalSchema.parse({
    kind: options.kind ?? "fact",
    key: options.key ?? "database.primary",
    value: options.value ?? "PostgreSQL",
    scope: options.scope ?? { tags: [] },
    authority: "authoritative",
    confidence: 0.9,
    provenance: [
      {
        projectId: ids.project,
        conversationId: ids.conversation,
        messageIds: [ids.message],
        actor: { type: "human", userId: ids.user },
        modelRunId: null,
        recordedAt: "2026-08-23T00:00:00.000Z",
      },
    ],
    explicitSupersedesVersionId: options.explicitSupersedesVersionId ?? null,
  });
}

function change(value: Record<string, unknown>): ContextDeltaChange {
  return contextDeltaChangeSchema.parse({ id: ids.change, ...value });
}

function delta(changes: readonly ContextDeltaChange[], deltaId = ids.delta) {
  return contextDeltaSchema.parse({
    id: deltaId,
    projectId: ids.project,
    branchId: ids.branch,
    conversationId: ids.conversation,
    baseCommitId: ids.baseCommit,
    throughMessageSequence: 1,
    schemaVersion: 1,
    extractorRunId: null,
    revisionOf: null,
    contentHash: "b".repeat(64),
    proposedBy: { type: "human", userId: ids.user },
    createdAt: "2026-08-23T00:00:00.000Z",
    changes,
  });
}

function snapshot(
  commitId: string,
  items: readonly ContextItemVersion[],
  options: { readonly ancestors?: readonly string[]; readonly applied?: readonly string[] } = {},
): ContextSnapshot {
  return {
    projectId: projectIdSchema.parse(ids.project),
    commitId: contextCommitIdSchema.parse(commitId),
    version: commitId === ids.baseCommit ? 1 : 2,
    items,
    ancestorCommitIds: (options.ancestors ?? []).map((id) => contextCommitIdSchema.parse(id)),
    appliedDeltaIds: (options.applied ?? []).map((id) => contextDeltaIdSchema.parse(id)),
  };
}

describe("deterministic semantic three-way merge", () => {
  it("treats an empty Delta as identity", () => {
    const base = snapshot(ids.baseCommit, []);
    const plan = createThreeWayMergePlan(delta([]), base, base);
    expect(plan.cleanChanges).toEqual([]);
    expect(plan.conflicts).toEqual([]);
    expect(plan.duplicates).toEqual([]);
    expect(plan.requiresHumanReview).toBe(false);
  });

  it("classifies a new disjoint key as C0", () => {
    const existing = item();
    const add = change({
      operation: "add",
      proposal: proposal({ key: "deployment.runtime", value: "Docker" }),
    });
    const base = snapshot(ids.baseCommit, [existing]);
    const plan = createThreeWayMergePlan(delta([add]), base, base);
    expect(plan.cleanChanges).toHaveLength(1);
    expect(plan.cleanChanges[0]?.classification).toBe("C0");
    expect(plan.conflicts).toEqual([]);
  });

  it("does not deduplicate case- or whitespace-sensitive values", () => {
    const existing = item({ value: "  PostgreSQL  " });
    const add = change({ operation: "add", proposal: proposal({ value: "postgresql" }) });
    const base = snapshot(ids.baseCommit, [existing]);
    const plan = createThreeWayMergePlan(delta([add]), base, base);
    expect(plan.duplicates).toEqual([]);
    expect(plan.cleanChanges).toEqual([]);
    expect(plan.conflicts).toHaveLength(1);
    expect(plan.conflicts[0]?.classification).toBe("C3");
  });

  it("classifies allow-listed object expansion as C1", () => {
    const existing = item({ value: { technology: "PostgreSQL" } });
    const add = change({
      operation: "add",
      proposal: proposal({ value: { extension: "pgvector" } }),
    });
    const base = snapshot(ids.baseCommit, [existing]);
    const plan = createThreeWayMergePlan(delta([add]), base, base);
    expect(plan.cleanChanges[0]?.classification).toBe("C1");
    expect(plan.cleanChanges[0]?.effectiveProposal?.value).toEqual({
      extension: "pgvector",
      technology: "PostgreSQL",
    });
  });

  it("classifies uncertain overlapping scopes as C2", () => {
    const existing = item({ scope: { environment: "production", tags: [] } });
    const add = change({
      operation: "add",
      proposal: proposal({ scope: { component: "api", tags: [] }, value: "MySQL" }),
    });
    const base = snapshot(ids.baseCommit, [existing]);
    const plan = createThreeWayMergePlan(delta([add]), base, base);
    expect(plan.conflicts[0]?.classification).toBe("C2");
  });

  it("classifies mutually exclusive authoritative decisions as C3", () => {
    const existing = item({ kind: "decision", value: "PostgreSQL" });
    const add = change({
      operation: "add",
      proposal: proposal({ kind: "decision", value: "MySQL" }),
    });
    const base = snapshot(ids.baseCommit, [existing]);
    const plan = createThreeWayMergePlan(delta([add]), base, base);
    expect(plan.conflicts[0]?.classification).toBe("C3");
    expect(plan.requiresHumanReview).toBe(true);
  });

  it("uses C4 only for an explicit supersession target", () => {
    const existing = item();
    const add = change({
      operation: "add",
      proposal: proposal({
        value: "CockroachDB",
        explicitSupersedesVersionId: ids.baseVersion,
      }),
    });
    const base = snapshot(ids.baseCommit, [existing]);
    const plan = createThreeWayMergePlan(delta([add]), base, base);
    expect(plan.cleanChanges[0]?.classification).toBe("C4");
  });

  it("marks a valid ancestor base as stale but still evaluates the merge", () => {
    const add = change({
      operation: "add",
      proposal: proposal({ key: "deployment.runtime", value: "Docker" }),
    });
    const base = snapshot(ids.baseCommit, []);
    const current = snapshot(ids.headCommit, [], { ancestors: [ids.baseCommit] });
    const plan = createThreeWayMergePlan(delta([add]), base, current);
    expect(plan.warnings[0]?.code).toBe("STALE_BASE");
    expect(plan.cleanChanges).toHaveLength(1);
  });

  it("rejects a non-ancestor or cross-project merge input", () => {
    const base = snapshot(ids.baseCommit, []);
    const unrelated = snapshot(ids.headCommit, []);
    expect(() => createThreeWayMergePlan(delta([]), base, unrelated)).toThrow("not an ancestor");

    const wrongProject = { ...base, projectId: projectIdSchema.parse(ids.otherProject) };
    expect(() => createThreeWayMergePlan(delta([]), wrongProject, base)).toThrow("one project");
  });

  it("is idempotent when the same Delta is applied repeatedly", () => {
    const add = change({
      operation: "add",
      proposal: proposal({ key: "deployment.runtime", value: "Docker" }),
    });
    const appliedDelta = delta([add]);
    const base = snapshot(ids.baseCommit, []);
    const current = snapshot(ids.baseCommit, [], { applied: [ids.delta] });
    const firstRetry = createThreeWayMergePlan(appliedDelta, base, current);
    const secondRetry = createThreeWayMergePlan(appliedDelta, base, current);
    expect(firstRetry).toEqual(secondRetry);
    expect(firstRetry.duplicates).toHaveLength(1);
    expect(firstRetry.cleanChanges).toEqual([]);
  });

  it("applies an update only when its base target has not moved", () => {
    const before = item();
    const update = change({
      operation: "update",
      targetLogicalItemId: ids.logical,
      expectedBaseVersionId: ids.baseVersion,
      proposal: proposal({ value: "PostgreSQL 18" }),
    });
    const base = snapshot(ids.baseCommit, [before]);
    const plan = createThreeWayMergePlan(delta([update]), base, base);
    expect(plan.cleanChanges[0]?.classification).toBe("C0");
  });

  it("does not roll current HEAD back when a stale Branch proposes its Base value", () => {
    const before = item();
    const current = item({
      id: ids.currentVersion,
      commitId: ids.headCommit,
      previousVersionId: ids.baseVersion,
      value: "PostgreSQL 18",
    });
    const update = change({
      operation: "update",
      targetLogicalItemId: ids.logical,
      expectedBaseVersionId: ids.baseVersion,
      proposal: proposal({ value: "PostgreSQL" }),
    });
    const plan = createThreeWayMergePlan(
      delta([update]),
      snapshot(ids.baseCommit, [before]),
      snapshot(ids.headCommit, [current], { ancestors: [ids.baseCommit] }),
    );
    expect(plan.duplicates).toHaveLength(1);
    expect(plan.warnings.some((warning) => warning.code === "BRANCH_DID_NOT_CHANGE_VALUE")).toBe(
      true,
    );
  });

  it("requires review when current and proposed both changed from Base", () => {
    const before = item({ kind: "decision" });
    const current = item({
      id: ids.currentVersion,
      commitId: ids.headCommit,
      previousVersionId: ids.baseVersion,
      kind: "decision",
      value: "CockroachDB",
    });
    const update = change({
      operation: "update",
      targetLogicalItemId: ids.logical,
      expectedBaseVersionId: ids.baseVersion,
      proposal: proposal({ kind: "decision", value: "MySQL" }),
    });
    const plan = createThreeWayMergePlan(
      delta([update]),
      snapshot(ids.baseCommit, [before]),
      snapshot(ids.headCommit, [current], { ancestors: [ids.baseCommit] }),
    );
    expect(plan.conflicts[0]?.classification).toBe("C3");
  });

  it("handles deprecation, repeated deprecation, and stale deprecation conservatively", () => {
    const before = item();
    const deprecate = change({
      operation: "deprecate",
      targetLogicalItemId: ids.logical,
      expectedBaseVersionId: ids.baseVersion,
      provenance: proposal().provenance,
    });
    const base = snapshot(ids.baseCommit, [before]);
    expect(createThreeWayMergePlan(delta([deprecate]), base, base).cleanChanges[0]?.classification).toBe(
      "C4",
    );

    const inactive = item({ lifecycle: "deprecated" });
    const repeated = createThreeWayMergePlan(
      delta([deprecate]),
      base,
      snapshot(ids.baseCommit, [inactive]),
    );
    expect(repeated.duplicates).toHaveLength(1);
    expect(repeated.warnings[0]?.code).toBe("TARGET_ALREADY_INACTIVE");

    const moved = item({ id: ids.currentVersion, commitId: ids.headCommit, value: "PostgreSQL 18" });
    const stale = createThreeWayMergePlan(
      delta([deprecate]),
      base,
      snapshot(ids.headCommit, [moved], { ancestors: [ids.baseCommit] }),
    );
    expect(stale.conflicts[0]?.classification).toBe("C2");
  });

  it("preserves high-risk review across simultaneous partial results", () => {
    const existing = item({ kind: "decision" });
    const duplicate = change({
      operation: "add",
      proposal: proposal({ kind: "decision" }),
    });
    const clean = contextDeltaChangeSchema.parse({
      id: "00000000-0000-4000-8000-000000000014",
      operation: "add",
      proposal: proposal({ key: "api.protocol", kind: "requirement", value: "REST" }),
    });
    const conflict = contextDeltaChangeSchema.parse({
      id: "00000000-0000-4000-8000-000000000015",
      operation: "add",
      proposal: proposal({
        kind: "decision",
        value: "MySQL",
        scope: { component: "api", tags: [] },
      }),
    });
    const base = snapshot(ids.baseCommit, [existing]);
    const plan = createThreeWayMergePlan(delta([duplicate, clean, conflict]), base, base);
    expect(plan.duplicates).toHaveLength(1);
    expect(plan.cleanChanges).toHaveLength(1);
    expect(plan.cleanChanges[0]?.requiresHumanReview).toBe(true);
    expect(plan.conflicts).toHaveLength(1);
  });
});
