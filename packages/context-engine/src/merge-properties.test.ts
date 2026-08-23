import {
  contextCommitIdSchema,
  contextDeltaChangeSchema,
  contextDeltaIdSchema,
  contextDeltaSchema,
  contextItemProposalSchema,
  projectIdSchema,
} from "@cce/domain";
import fc from "fast-check";
import { describe, expect, it } from "vitest";

import type { ContextSnapshot } from "./merge-types";
import { createThreeWayMergePlan } from "./three-way-merge";

const projectId = projectIdSchema.parse("10000000-0000-4000-8000-000000000001");
const commitId = contextCommitIdSchema.parse("10000000-0000-4000-8000-000000000002");
const deltaId = contextDeltaIdSchema.parse("10000000-0000-4000-8000-000000000003");

const emptySnapshot: ContextSnapshot = {
  projectId,
  commitId,
  version: 1,
  items: [],
  ancestorCommitIds: [],
  appliedDeltaIds: [],
};

function proposedFact(key: string, value: string) {
  return contextItemProposalSchema.parse({
    kind: "fact",
    key,
    value,
    scope: { tags: [] },
    authority: "authoritative",
    confidence: 1,
    provenance: [
      {
        projectId,
        conversationId: "10000000-0000-4000-8000-000000000004",
        messageIds: ["10000000-0000-4000-8000-000000000005"],
        actor: { type: "human", userId: "10000000-0000-4000-8000-000000000006" },
        modelRunId: null,
        recordedAt: "2026-08-23T00:00:00.000Z",
      },
    ],
    explicitSupersedesVersionId: null,
  });
}

function proposedDelta(entries: readonly { readonly id: string; readonly key: string; readonly value: string }[]) {
  return contextDeltaSchema.parse({
    id: deltaId,
    projectId,
    branchId: "10000000-0000-4000-8000-000000000007",
    conversationId: "10000000-0000-4000-8000-000000000004",
    baseCommitId: commitId,
    throughMessageSequence: 1,
    schemaVersion: 1,
    extractorRunId: null,
    revisionOf: null,
    contentHash: "c".repeat(64),
    proposedBy: { type: "human", userId: "10000000-0000-4000-8000-000000000006" },
    createdAt: "2026-08-23T00:00:00.000Z",
    changes: entries.map((entry) =>
      contextDeltaChangeSchema.parse({
        id: entry.id,
        operation: "add",
        proposal: proposedFact(entry.key, entry.value),
      }),
    ),
  });
}

describe("merge engine properties", () => {
  it("is deterministic and preserves provenance for generated clean changes", () => {
    fc.assert(
      fc.property(
        fc.stringMatching(/^[a-z]{1,10}$/),
        fc.string({ minLength: 1, maxLength: 40 }),
        (keySuffix, value) => {
          const delta = proposedDelta([
            {
              id: "10000000-0000-4000-8000-000000000008",
              key: `fact.${keySuffix}`,
              value,
            },
          ]);
          const first = createThreeWayMergePlan(delta, emptySnapshot, emptySnapshot);
          const second = createThreeWayMergePlan(delta, emptySnapshot, emptySnapshot);
          expect(first).toEqual(second);
          expect(first.cleanChanges[0]?.effectiveProposal?.provenance).toEqual(
            delta.changes[0]?.operation === "add" ? delta.changes[0].proposal.provenance : [],
          );
        },
      ),
      { seed: 20_260_823, numRuns: 100 },
    );
  });

  it("produces the same semantic set for disjoint changes in either order", () => {
    fc.assert(
      fc.property(
        fc.stringMatching(/^[a-z]{1,8}$/),
        fc.stringMatching(/^[a-z]{1,8}$/).filter((value) => value.length > 0),
        (leftSuffix, rightSuffix) => {
          fc.pre(leftSuffix !== rightSuffix);
          const left = {
            id: "10000000-0000-4000-8000-000000000008",
            key: `fact.${leftSuffix}`,
            value: "left",
          };
          const right = {
            id: "10000000-0000-4000-8000-000000000009",
            key: `fact.${rightSuffix}`,
            value: "right",
          };
          const normal = createThreeWayMergePlan(
            proposedDelta([left, right]),
            emptySnapshot,
            emptySnapshot,
          );
          const reversed = createThreeWayMergePlan(
            proposedDelta([right, left]),
            emptySnapshot,
            emptySnapshot,
          );
          const keys = (plan: typeof normal) =>
            plan.cleanChanges
              .map((entry) => entry.effectiveProposal?.key)
              .filter((value) => value !== undefined)
              .sort();
          expect(keys(normal)).toEqual(keys(reversed));
        },
      ),
      { seed: 20_260_823, numRuns: 100 },
    );
  });

  it("never silently applies a generated high-risk decision", () => {
    fc.assert(
      fc.property(fc.string({ minLength: 1, maxLength: 40 }), (value) => {
        const factDelta = proposedDelta([
          {
            id: "10000000-0000-4000-8000-000000000008",
            key: "database.primary",
            value,
          },
        ]);
        const firstChange = factDelta.changes[0];
        if (firstChange === undefined || firstChange.operation !== "add") {
          throw new Error("Generated test Delta must contain an add change.");
        }
        const decisionProposal = contextItemProposalSchema.parse({
          ...firstChange.proposal,
          kind: "decision",
        });
        const decisionChange = contextDeltaChangeSchema.parse({
          id: "10000000-0000-4000-8000-000000000008",
          operation: "add",
          proposal: decisionProposal,
        });
        const decisionDelta = contextDeltaSchema.parse({ ...factDelta, changes: [decisionChange] });
        const plan = createThreeWayMergePlan(decisionDelta, emptySnapshot, emptySnapshot);
        expect(plan.cleanChanges[0]?.requiresHumanReview).toBe(true);
        expect(plan.requiresHumanReview).toBe(true);
      }),
      { seed: 20_260_823, numRuns: 100 },
    );
  });

  it("is idempotent for every generated replayed Delta", () => {
    fc.assert(
      fc.property(fc.stringMatching(/^[a-z]{1,10}$/), (suffix) => {
        const delta = proposedDelta([
          {
            id: "10000000-0000-4000-8000-000000000008",
            key: `fact.${suffix}`,
            value: suffix,
          },
        ]);
        const applied = { ...emptySnapshot, appliedDeltaIds: [deltaId] };
        const plan = createThreeWayMergePlan(delta, emptySnapshot, applied);
        expect(plan.cleanChanges).toEqual([]);
        expect(plan.duplicates).toHaveLength(1);
      }),
      { seed: 20_260_823, numRuns: 100 },
    );
  });
});
