import {
  contextCommitIdSchema,
  contextDeltaChangeSchema,
  contextDeltaSchema,
  contextItemProposalSchema,
  projectIdSchema,
} from "@cce/domain";
import { describe, expect, it, vi } from "vitest";

import type { MergePlan } from "./merge-types";
import { classifyPotentialConflicts, type SemanticConflictClassifier } from "./semantic-classifier";

const projectId = projectIdSchema.parse("30000000-0000-4000-8000-000000000001");
const commitId = contextCommitIdSchema.parse("30000000-0000-4000-8000-000000000002");
const proposal = contextItemProposalSchema.parse({
  kind: "fact",
  key: "deployment.runtime",
  value: "Kubernetes",
  scope: { tags: [] },
  authority: "authoritative",
  confidence: 0.8,
  provenance: [
    {
      projectId,
      conversationId: "30000000-0000-4000-8000-000000000003",
      messageIds: ["30000000-0000-4000-8000-000000000004"],
      actor: { type: "human", userId: "30000000-0000-4000-8000-000000000005" },
      modelRunId: null,
      recordedAt: "2026-08-23T00:00:00.000Z",
    },
  ],
  explicitSupersedesVersionId: null,
});
const change = contextDeltaChangeSchema.parse({
  id: "30000000-0000-4000-8000-000000000006",
  operation: "add",
  proposal,
});
const delta = contextDeltaSchema.parse({
  id: "30000000-0000-4000-8000-000000000007",
  projectId,
  branchId: "30000000-0000-4000-8000-000000000008",
  conversationId: "30000000-0000-4000-8000-000000000003",
  baseCommitId: commitId,
  throughMessageSequence: 1,
  schemaVersion: 1,
  extractorRunId: null,
  revisionOf: null,
  contentHash: "e".repeat(64),
  proposedBy: { type: "human", userId: "30000000-0000-4000-8000-000000000005" },
  createdAt: "2026-08-23T00:00:00.000Z",
  changes: [change],
});

function plan(classification: "C2" | "C3" = "C2"): MergePlan {
  return {
    projectId,
    delta,
    baseCommitId: commitId,
    evaluatedHeadCommitId: commitId,
    cleanChanges: [],
    duplicates: [],
    warnings: [],
    conflicts: [
      {
        change,
        classification,
        baseVersion: null,
        currentVersion: null,
        proposed: proposal,
        reason: "Environment scope may differ.",
        requiresHumanReview: true,
      },
    ],
    requiresHumanReview: true,
  };
}

describe("semantic conflict classifier boundary", () => {
  it("calls a classifier only for C2 and preserves its result as a proposal", async () => {
    const classify = vi.fn<SemanticConflictClassifier["classify"]>().mockResolvedValue({
      classification: "C3",
      confidence: 0.91,
      rationale: "Both values describe the production orchestrator.",
    });
    const reviews = await classifyPotentialConflicts(plan(), { classify });
    expect(classify).toHaveBeenCalledOnce();
    expect(reviews[0]?.proposal.classification).toBe("C3");
    expect(reviews[0]?.acceptedForDisplay).toBe(true);

    expect(await classifyPotentialConflicts(plan("C3"), { classify })).toEqual([]);
    expect(classify).toHaveBeenCalledOnce();
  });

  it("keeps low-confidence suggestions visibly untrusted", async () => {
    const reviews = await classifyPotentialConflicts(plan(), {
      classify: async () => ({
        classification: "C1",
        confidence: 0.4,
        rationale: "Possibly separate environments.",
      }),
    });
    expect(reviews[0]?.acceptedForDisplay).toBe(false);
    expect(reviews[0]?.error).toBeNull();
  });

  it("falls back to C2 human review on provider or malformed output", async () => {
    const failed = await classifyPotentialConflicts(plan(), {
      classify: async () => {
        throw new Error("offline");
      },
    });
    expect(failed[0]?.proposal.classification).toBe("C2");
    expect(failed[0]?.acceptedForDisplay).toBe(false);
    expect(failed[0]?.error).toBe("offline");

    const malformed = await classifyPotentialConflicts(plan(), {
      classify: async () => ({
        classification: "C1",
        confidence: Number.NaN,
        rationale: "invalid",
      }),
    });
    expect(malformed[0]?.proposal.classification).toBe("C2");
    expect(malformed[0]?.error).toContain("invalid semantic classification");
  });
});

