import { describe, expect, it } from "vitest";

import {
  assertMergeRequestTransition,
  mergeConflictSchema,
  mergeFinalizationSchema,
  mergeRequestSchema,
  mergeResolutionSchema,
} from "./merge";

const ids = {
  project: "00000000-0000-4000-8000-000000000001",
  mergeRequest: "00000000-0000-4000-8000-000000000002",
  conflict: "00000000-0000-4000-8000-000000000003",
  deltaChange: "00000000-0000-4000-8000-000000000004",
  delta: "00000000-0000-4000-8000-000000000005",
  branch: "00000000-0000-4000-8000-000000000006",
  baseCommit: "00000000-0000-4000-8000-000000000007",
  headCommit: "00000000-0000-4000-8000-000000000008",
  resultingCommit: "00000000-0000-4000-8000-000000000009",
  user: "00000000-0000-4000-8000-000000000010",
} as const;

describe("Merge review invariants", () => {
  it("requires an edited proposal only for edit resolutions", () => {
    const base = {
      choice: "keep_current",
      editedProposal: null,
      rationale: "The current decision remains valid.",
      resolvedBy: ids.user,
      resolvedAt: "2026-08-23T00:00:00.000Z",
    };
    expect(mergeResolutionSchema.safeParse(base).success).toBe(true);
    expect(
      mergeResolutionSchema.safeParse({ ...base, choice: "edit", editedProposal: null }).success,
    ).toBe(false);
  });

  it("does not classify duplicates as human conflicts", () => {
    const result = mergeConflictSchema.safeParse({
      id: ids.conflict,
      projectId: ids.project,
      mergeRequestId: ids.mergeRequest,
      deltaChangeId: ids.deltaChange,
      classification: "duplicate",
      baseVersion: null,
      currentVersion: null,
      proposed: null,
      reason: "Already present",
      requiresHumanReview: true,
      resolution: null,
      createdAt: "2026-08-23T00:00:00.000Z",
    });
    expect(result.success).toBe(false);
  });

  it("requires a current value for direct conflicts", () => {
    const result = mergeConflictSchema.safeParse({
      id: ids.conflict,
      projectId: ids.project,
      mergeRequestId: ids.mergeRequest,
      deltaChangeId: ids.deltaChange,
      classification: "C3",
      baseVersion: null,
      currentVersion: null,
      proposed: null,
      reason: "Mutually exclusive values",
      requiresHumanReview: true,
      resolution: null,
      createdAt: "2026-08-23T00:00:00.000Z",
    });
    expect(result.success).toBe(false);
  });

  it("allows only declared MergeRequest transitions", () => {
    expect(() => assertMergeRequestTransition("draft", "reviewing")).not.toThrow();
    expect(() => assertMergeRequestTransition("reviewing", "ready")).not.toThrow();
    expect(() => assertMergeRequestTransition("ready", "committed")).not.toThrow();
    expect(() => assertMergeRequestTransition("committed", "reviewing")).toThrow(
      "cannot transition",
    );
  });

  it("requires only committed requests to carry a resulting commit", () => {
    const request = {
      id: ids.mergeRequest,
      projectId: ids.project,
      branchId: ids.branch,
      deltaId: ids.delta,
      baseCommitId: ids.baseCommit,
      evaluatedHeadCommitId: ids.headCommit,
      resultingCommitId: null,
      status: "ready",
      createdBy: { type: "human", userId: ids.user },
      createdAt: "2026-08-23T00:00:00.000Z",
      updatedAt: "2026-08-23T00:00:00.000Z",
    };
    expect(mergeRequestSchema.safeParse(request).success).toBe(true);
    expect(
      mergeRequestSchema.safeParse({
        ...request,
        status: "committed",
        resultingCommitId: ids.resultingCommit,
      }).success,
    ).toBe(true);
    expect(
      mergeRequestSchema.safeParse({ ...request, resultingCommitId: ids.resultingCommit }).success,
    ).toBe(false);
  });

  it("persists an immutable-shaped finalization outcome for retries", () => {
    const base = {
      projectId: ids.project,
      mergeRequestId: ids.mergeRequest,
      operationKey: "merge:request:key-hash",
      finalizedAt: "2026-08-23T00:00:00.000Z",
    };
    expect(
      mergeFinalizationSchema.safeParse({
        ...base,
        outcome: "no_changes",
        resultingCommitId: null,
      }).success,
    ).toBe(true);
    expect(
      mergeFinalizationSchema.safeParse({
        ...base,
        outcome: "committed",
        resultingCommitId: ids.resultingCommit,
      }).success,
    ).toBe(true);
    expect(
      mergeFinalizationSchema.safeParse({
        ...base,
        outcome: "no_changes",
        resultingCommitId: ids.resultingCommit,
      }).success,
    ).toBe(false);
  });
});
