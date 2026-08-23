import {
  contextCommitIdSchema,
  contextDeltaSchema,
  contextItemProposalSchema,
  contextItemVersionSchema,
  projectIdSchema,
  type ContextItemProposal,
  type ContextItemVersion,
} from "@cce/domain";
import { createThreeWayMergePlan, type ContextSnapshot } from "@cce/context-engine";
import { describe, expect, it } from "vitest";
import { z } from "zod";

import corpus from "./merge-corpus.json";

const fixtureSchema = z.array(
  z.object({
    name: z.string().min(1),
    existing: z
      .object({
        kind: z.string(),
        key: z.string(),
        value: z.json(),
        scope: z.record(z.string(), z.json()),
      })
      .nullable(),
    proposal: z.object({
      kind: z.string(),
      key: z.string(),
      value: z.json(),
      scope: z.record(z.string(), z.json()),
      explicitSupersedes: z.boolean().optional(),
    }),
    expectedBucket: z.enum(["clean", "conflict", "duplicate"]),
    expectedClassification: z.enum(["C0", "C1", "C2", "C3", "C4"]).nullable(),
  }),
);

const ids = {
  project: "00000000-0000-4000-8000-000000000001",
  commit: "00000000-0000-4000-8000-000000000002",
  branch: "00000000-0000-4000-8000-000000000003",
  conversation: "00000000-0000-4000-8000-000000000004",
  message: "00000000-0000-4000-8000-000000000005",
  user: "00000000-0000-4000-8000-000000000006",
  delta: "00000000-0000-4000-8000-000000000007",
  change: "00000000-0000-4000-8000-000000000008",
  logical: "00000000-0000-4000-8000-000000000009",
  version: "00000000-0000-4000-8000-000000000010",
} as const;

const provenance = [
  {
    projectId: ids.project,
    conversationId: ids.conversation,
    messageIds: [ids.message],
    actor: { type: "human" as const, userId: ids.user },
    modelRunId: null,
    recordedAt: "2026-08-23T00:00:00.000Z",
  },
];

function existingVersion(
  raw: NonNullable<z.infer<typeof fixtureSchema>[number]["existing"]>,
): ContextItemVersion {
  return contextItemVersionSchema.parse({
    id: ids.version,
    logicalItemId: ids.logical,
    projectId: ids.project,
    commitId: ids.commit,
    previousVersionId: null,
    kind: raw.kind,
    key: raw.key,
    value: raw.value,
    scope: raw.scope,
    authority: "authoritative",
    confidence: 1,
    provenance,
    lifecycle: "active",
    scopeHash: "a".repeat(64),
    supersedesVersionId: null,
    createdAt: "2026-08-23T00:00:00.000Z",
  });
}

function proposal(
  raw: z.infer<typeof fixtureSchema>[number]["proposal"],
): ContextItemProposal {
  return contextItemProposalSchema.parse({
    kind: raw.kind,
    key: raw.key,
    value: raw.value,
    scope: raw.scope,
    authority: "authoritative",
    confidence: 0.9,
    provenance,
    explicitSupersedesVersionId: raw.explicitSupersedes === true ? ids.version : null,
  });
}

describe("versioned deterministic merge evaluation corpus", () => {
  for (const fixture of fixtureSchema.parse(corpus)) {
    it(fixture.name, () => {
      const items = fixture.existing === null ? [] : [existingVersion(fixture.existing)];
      const snapshot: ContextSnapshot = {
        projectId: projectIdSchema.parse(ids.project),
        commitId: contextCommitIdSchema.parse(ids.commit),
        version: 0,
        items,
        ancestorCommitIds: [],
        appliedDeltaIds: [],
      };
      const delta = contextDeltaSchema.parse({
        id: ids.delta,
        projectId: ids.project,
        branchId: ids.branch,
        conversationId: ids.conversation,
        baseCommitId: ids.commit,
        throughMessageSequence: 1,
        schemaVersion: 1,
        extractorRunId: null,
        revisionOf: null,
        contentHash: "b".repeat(64),
        proposedBy: { type: "human", userId: ids.user },
        createdAt: "2026-08-23T00:00:00.000Z",
        changes: [{ id: ids.change, operation: "add", proposal: proposal(fixture.proposal) }],
      });

      const plan = createThreeWayMergePlan(delta, snapshot, snapshot);
      const actual =
        fixture.expectedBucket === "clean"
          ? plan.cleanChanges[0]
          : fixture.expectedBucket === "conflict"
            ? plan.conflicts[0]
            : plan.duplicates[0];
      expect(actual).toBeDefined();
      const classification =
        actual !== undefined && "classification" in actual ? actual.classification : null;
      expect(classification).toBe(fixture.expectedClassification);
      expect(
        plan.cleanChanges.length + plan.conflicts.length + plan.duplicates.length,
      ).toBe(1);
    });
  }
});
