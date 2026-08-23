import { describe, expect, it } from "vitest";

import { actorSchema } from "./actor";
import {
  assertHighRiskApproval,
  assertSameProjectProvenance,
  contextItemProposalSchema,
  contextItemVersionSchema,
  contextScopeSchema,
  isHighRiskContextKind,
  provenanceSchema,
} from "./context-item";
import { projectIdSchema } from "./ids";

const ids = {
  project: "00000000-0000-4000-8000-000000000001",
  otherProject: "00000000-0000-4000-8000-000000000002",
  conversation: "00000000-0000-4000-8000-000000000003",
  message: "00000000-0000-4000-8000-000000000004",
  user: "00000000-0000-4000-8000-000000000005",
  modelRun: "00000000-0000-4000-8000-000000000006",
  itemVersion: "00000000-0000-4000-8000-000000000007",
  logicalItem: "00000000-0000-4000-8000-000000000008",
  commit: "00000000-0000-4000-8000-000000000009",
} as const;

function provenance(projectId: string = ids.project) {
  return provenanceSchema.parse({
    projectId,
    conversationId: ids.conversation,
    messageIds: [ids.message],
    actor: { type: "human", userId: ids.user },
    modelRunId: null,
    recordedAt: "2026-08-23T00:00:00.000Z",
  });
}

describe("ContextItem invariants", () => {
  it("rejects duplicate evidence message identifiers", () => {
    const result = provenanceSchema.safeParse({
      ...provenance(),
      messageIds: [ids.message, ids.message],
    });
    expect(result.success).toBe(false);
  });

  it("normalizes Context keys at the boundary rather than accepting free text", () => {
    const result = contextItemProposalSchema.safeParse({
      kind: "decision",
      key: "Database Primary",
      value: "PostgreSQL",
      scope: { tags: [] },
      confidence: 0.9,
      provenance: [provenance()],
    });
    expect(result.success).toBe(false);
  });

  it("rejects inverted effective periods", () => {
    expect(
      contextScopeSchema.safeParse({
        tags: [],
        effectiveFrom: "2026-09-01T00:00:00.000Z",
        effectiveTo: "2026-08-01T00:00:00.000Z",
      }).success,
    ).toBe(false);
    expect(
      contextScopeSchema.safeParse({
        tags: [],
        effectiveFrom: "2026-01-01T10:45:00+10:00",
        effectiveTo: "2026-01-01T00:30:00Z",
      }).success,
    ).toBe(false);
  });

  it("rejects ContextItem provenance from another project", () => {
    const result = contextItemVersionSchema.safeParse({
      id: ids.itemVersion,
      logicalItemId: ids.logicalItem,
      projectId: ids.project,
      commitId: ids.commit,
      previousVersionId: null,
      kind: "fact",
      key: "database.primary",
      value: "PostgreSQL",
      scope: { tags: [] },
      authority: "authoritative",
      confidence: 1,
      provenance: [provenance(ids.otherProject)],
      lifecycle: "active",
      scopeHash: "a".repeat(64),
      supersedesVersionId: null,
      createdAt: "2026-08-23T00:00:00.000Z",
    });
    expect(result.success).toBe(false);
  });

  it("requires an explicit relationship for superseded item versions", () => {
    const result = contextItemVersionSchema.safeParse({
      id: ids.itemVersion,
      logicalItemId: ids.logicalItem,
      projectId: ids.project,
      commitId: ids.commit,
      previousVersionId: null,
      kind: "fact",
      key: "database.primary",
      value: "PostgreSQL",
      scope: { tags: [] },
      authority: "authoritative",
      confidence: 1,
      provenance: [provenance()],
      lifecycle: "superseded",
      scopeHash: "a".repeat(64),
      supersedesVersionId: null,
      createdAt: "2026-08-23T00:00:00.000Z",
    });
    expect(result.success).toBe(false);
  });

  it("requires a human for every high-risk context kind", () => {
    const human = actorSchema.parse({ type: "human", userId: ids.user });
    const model = actorSchema.parse({
      type: "model",
      provider: "fake",
      model: "fake-small",
      runId: ids.modelRun,
    });

    for (const kind of ["decision", "requirement", "constraint", "architecture"] as const) {
      expect(isHighRiskContextKind(kind)).toBe(true);
      expect(() => assertHighRiskApproval(kind, model)).toThrow("authorized human");
      expect(() => assertHighRiskApproval(kind, human)).not.toThrow();
    }
    expect(() => assertHighRiskApproval("fact", model)).not.toThrow();
  });

  it("requires non-empty, same-project provenance in programmatic construction", () => {
    const projectId = projectIdSchema.parse(ids.project);
    expect(() => assertSameProjectProvenance(projectId, [])).toThrow("At least one provenance");
    expect(() => assertSameProjectProvenance(projectId, [provenance(ids.otherProject)])).toThrow(
      "same project",
    );
  });
});
