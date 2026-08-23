import {
  ExtractionService,
  MergeService,
  type EditableContextItemProposal,
  type ModelResponse,
} from "@cce/application";
import {
  contextCommitIdSchema,
  contextCommitSchema,
  contextDeltaSchema,
  contextItemProposalSchema,
  contextItemVersionIdSchema,
  contextItemVersionSchema,
  mergeConflictSchema,
  mergeRequestSchema,
} from "@cce/domain";
import { ScriptedModelProvider } from "@cce/test-support";
import { describe, expect, it } from "vitest";

import { createFixture, idsFrom, seedConversation, uuid } from "./fixtures";

function modelResponse(content: string): ModelResponse {
  return {
    providerResponseId: "extract-merge",
    provider: "test-provider",
    model: "test-model",
    content,
    finishReason: "stop",
    usage: { inputTokens: 10, cachedTokens: 0, outputTokens: 8 },
  };
}

function first<T>(values: readonly T[]): T {
  const value = values[0];
  if (value === undefined) {
    throw new Error("Expected one deterministic merge review entry.");
  }
  return value;
}

async function arrangeMerge(role: "owner" | "editor" = "owner", kind = "fact") {
  const fixture = createFixture(role);
  const { conversation, message } = seedConversation(fixture);
  const provider = new ScriptedModelProvider();
  provider.enqueueResponse(
    modelResponse(
      JSON.stringify({
        changes: [
          {
            operation: "add",
            proposal: {
              kind,
              key: kind === "decision" ? "database.choice" : "database.engine",
              value: "PostgreSQL",
              scope: { component: "database", tags: [] },
              confidence: 0.99,
              evidenceMessageIds: [message.id],
            },
          },
        ],
      }),
    ),
  );
  const extraction = new ExtractionService(
    fixture.unitOfWork,
    provider,
    idsFrom(100),
    fixture.clock,
    fixture.hasher,
  );
  const delta = await extraction.extract({
    projectId: fixture.project.id,
    conversationId: conversation.id,
    actorUserId: fixture.user.id,
  });
  const ids = idsFrom(200);
  const service = new MergeService(fixture.unitOfWork, ids, fixture.clock, fixture.hasher);
  const created = await service.create({
    projectId: fixture.project.id,
    deltaId: delta.id,
    actorUserId: fixture.user.id,
  });
  return { fixture, delta, service, ...created };
}

describe("MergeService", () => {
  it("requires human review, then atomically advances HEAD with immutable provenance", async () => {
    const arranged = await arrangeMerge();
    expect(arranged.request.status).toBe("reviewing");
    expect(arranged.conflicts).toMatchObject([
      { classification: "C0", requiresHumanReview: true, resolution: null },
    ]);
    const review = arranged.conflicts[0];
    expect(review).toBeDefined();
    if (review === undefined) {
      throw new Error("Expected the deterministic merge plan to contain one review entry.");
    }

    const ready = await arranged.service.resolve({
      projectId: arranged.fixture.project.id,
      mergeRequestId: arranged.request.id,
      conflictId: review.id,
      actorUserId: arranged.fixture.user.id,
      choice: "accept_proposed",
      editedProposal: null,
      rationale: "The evidence is direct and scoped.",
    });
    expect(ready.status).toBe("ready");

    const result = await arranged.service.finalize({
      projectId: arranged.fixture.project.id,
      mergeRequestId: arranged.request.id,
      actorUserId: arranged.fixture.user.id,
      expectedHeadCommitId: arranged.fixture.project.headCommitId,
      idempotencyKey: arranged.fixture.genesis.idempotencyKey,
      summary: "Record selected database",
    });

    expect(result.outcome).toBe("committed");
    expect(result.commit).toMatchObject({
      kind: "semantic",
      parentCommitId: arranged.fixture.genesis.id,
      version: 1,
      sourceDeltaIds: [arranged.delta.id],
      committedBy: { type: "human", userId: arranged.fixture.user.id },
    });
    expect(result.commit?.id).not.toBe(arranged.fixture.genesis.id);
    expect(result.commit?.idempotencyKey).not.toBe(arranged.fixture.genesis.idempotencyKey);
    expect(arranged.fixture.unitOfWork.view().projects[0]).toMatchObject({
      headCommitId: result.commit?.id,
      version: 1,
    });
    expect(arranged.fixture.unitOfWork.view().projection.size).toBe(1);
    const current = [...arranged.fixture.unitOfWork.view().projection.values()][0];
    expect(current).toMatchObject({
      key: "database.engine",
      value: "PostgreSQL",
      provenance: [{ messageIds: [uuid(6)] }],
    });
    if (result.commit === null) {
      throw new Error("Expected the accepted merge to create a semantic commit.");
    }

    const replay = await arranged.service.finalize({
      projectId: arranged.fixture.project.id,
      mergeRequestId: arranged.request.id,
      actorUserId: arranged.fixture.user.id,
      expectedHeadCommitId: result.commit.id,
      idempotencyKey: arranged.fixture.genesis.idempotencyKey,
      summary: "A retried request must not duplicate the commit",
    });
    expect(replay.commit?.id).toBe(result.commit?.id);
    expect(arranged.fixture.unitOfWork.view().commits).toHaveLength(2);
    expect(arranged.fixture.unitOfWork.view().mergeFinalizations).toMatchObject([
      {
        mergeRequestId: arranged.request.id,
        outcome: "committed",
        resultingCommitId: result.commit?.id,
      },
    ]);
    await expect(
      arranged.service.finalize({
        projectId: arranged.fixture.project.id,
        mergeRequestId: arranged.request.id,
        actorUserId: arranged.fixture.user.id,
        expectedHeadCommitId: result.commit.id,
        idempotencyKey: "a-different-committed-retry-key",
        summary: "A different key must not claim the prior commit",
      }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("rejects finalization against a stale expected HEAD", async () => {
    const arranged = await arrangeMerge();
    const review = first(arranged.conflicts);
    await arranged.service.resolve({
      projectId: arranged.fixture.project.id,
      mergeRequestId: arranged.request.id,
      conflictId: review.id,
      actorUserId: arranged.fixture.user.id,
      choice: "accept_proposed",
      editedProposal: null,
      rationale: "Ready for commit.",
    });

    await expect(
      arranged.service.finalize({
        projectId: arranged.fixture.project.id,
        mergeRequestId: arranged.request.id,
        actorUserId: arranged.fixture.user.id,
        expectedHeadCommitId: contextCommitIdSchema.parse(uuid(999)),
        idempotencyKey: "merge:stale",
        summary: "Must fail",
      }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    expect(arranged.fixture.unitOfWork.view().commits).toHaveLength(1);
    expect(arranged.fixture.unitOfWork.view().projects[0]?.version).toBe(0);
  });

  it("closes a fully reviewed keep-current merge without a semantic commit", async () => {
    const arranged = await arrangeMerge();
    await arranged.service.resolve({
      projectId: arranged.fixture.project.id,
      mergeRequestId: arranged.request.id,
      conflictId: first(arranged.conflicts).id,
      actorUserId: arranged.fixture.user.id,
      choice: "keep_current",
      editedProposal: null,
      rationale: "Do not add this proposal.",
    });
    const result = await arranged.service.finalize({
      projectId: arranged.fixture.project.id,
      mergeRequestId: arranged.request.id,
      actorUserId: arranged.fixture.user.id,
      expectedHeadCommitId: arranged.fixture.project.headCommitId,
      idempotencyKey: "merge:no-change",
      summary: "No accepted changes",
    });

    expect(result).toEqual({ outcome: "no_changes", commit: null });
    expect(arranged.fixture.unitOfWork.view().commits).toHaveLength(1);
    expect(arranged.fixture.unitOfWork.view().mergeRequests[0]?.status).toBe("rejected");
    expect(arranged.fixture.unitOfWork.view().mergeFinalizations).toMatchObject([
      {
        mergeRequestId: arranged.request.id,
        outcome: "no_changes",
        resultingCommitId: null,
      },
    ]);
    const finalizedAuditCount = arranged.fixture.unitOfWork.view().auditEvents.length;

    await expect(
      arranged.service.finalize({
        projectId: arranged.fixture.project.id,
        mergeRequestId: arranged.request.id,
        actorUserId: arranged.fixture.user.id,
        expectedHeadCommitId: arranged.fixture.project.headCommitId,
        idempotencyKey: "merge:no-change",
        summary: "Lost response retry",
      }),
    ).resolves.toEqual({ outcome: "no_changes", commit: null });
    expect(arranged.fixture.unitOfWork.view().mergeFinalizations).toHaveLength(1);
    expect(arranged.fixture.unitOfWork.view().auditEvents).toHaveLength(finalizedAuditCount);

    await expect(
      arranged.service.finalize({
        projectId: arranged.fixture.project.id,
        mergeRequestId: arranged.request.id,
        actorUserId: arranged.fixture.user.id,
        expectedHeadCommitId: arranged.fixture.project.headCommitId,
        idempotencyKey: "merge:no-change:different",
        summary: "A different operation must conflict",
      }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("requires an Owner to approve decision, requirement, constraint, or architecture", async () => {
    const arranged = await arrangeMerge("editor", "decision");

    await expect(
      arranged.service.resolve({
        projectId: arranged.fixture.project.id,
        mergeRequestId: arranged.request.id,
        conflictId: first(arranged.conflicts).id,
        actorUserId: arranged.fixture.user.id,
        choice: "accept_proposed",
        editedProposal: null,
        rationale: "An editor must not approve a decision.",
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(arranged.fixture.unitOfWork.view().mergeConflicts[0]?.resolution).toBeNull();
    expect(arranged.fixture.unitOfWork.view().mergeRequests[0]?.status).toBe("reviewing");
  });

  it("does not let an Editor downgrade a high-risk current item to evade Owner review", async () => {
    const fixture = createFixture("editor");
    const { conversation, branch, message } = seedConversation(fixture);
    const provenance = [
      {
        projectId: fixture.project.id,
        conversationId: conversation.id,
        messageIds: [message.id],
        actor: message.author,
        modelRunId: null,
        recordedAt: fixture.clock.now().toISOString(),
      },
    ];
    const current = contextItemVersionSchema.parse({
      id: uuid(300),
      logicalItemId: uuid(301),
      projectId: fixture.project.id,
      commitId: fixture.genesis.id,
      previousVersionId: null,
      kind: "decision",
      key: "database.choice",
      value: "PostgreSQL",
      scope: { tags: [] },
      authority: "authoritative",
      confidence: 1,
      provenance,
      lifecycle: "active",
      scopeHash: "a".repeat(64),
      supersedesVersionId: null,
      createdAt: fixture.clock.now().toISOString(),
    });
    const proposed = contextItemProposalSchema.parse({
      kind: "fact",
      key: "database.choice",
      value: "MySQL",
      scope: { tags: [] },
      authority: "authoritative",
      confidence: 0.8,
      provenance,
      explicitSupersedesVersionId: null,
    });
    const request = mergeRequestSchema.parse({
      id: uuid(302),
      projectId: fixture.project.id,
      branchId: branch.id,
      deltaId: uuid(303),
      baseCommitId: fixture.genesis.id,
      evaluatedHeadCommitId: fixture.genesis.id,
      resultingCommitId: null,
      status: "reviewing",
      createdBy: { type: "human", userId: fixture.user.id },
      createdAt: fixture.clock.now().toISOString(),
      updatedAt: fixture.clock.now().toISOString(),
    });
    const conflict = mergeConflictSchema.parse({
      id: uuid(304),
      projectId: fixture.project.id,
      mergeRequestId: request.id,
      deltaChangeId: uuid(305),
      classification: "C2",
      baseVersion: current,
      currentVersion: current,
      proposed,
      reason: "The proposal changes a high-risk item into a low-risk kind.",
      requiresHumanReview: true,
      resolution: null,
      createdAt: fixture.clock.now().toISOString(),
    });
    await fixture.unitOfWork.run((repositories) => repositories.merges.insert(request, [conflict]));
    const service = new MergeService(
      fixture.unitOfWork,
      idsFrom(400),
      fixture.clock,
      fixture.hasher,
    );

    await expect(
      service.resolve({
        projectId: fixture.project.id,
        mergeRequestId: request.id,
        conflictId: conflict.id,
        actorUserId: fixture.user.id,
        choice: "accept_proposed",
        editedProposal: null,
        rationale: "Attempted downgrade",
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(fixture.unitOfWork.view().mergeConflicts[0]?.resolution).toBeNull();

    await expect(
      service.resolve({
        projectId: fixture.project.id,
        mergeRequestId: request.id,
        conflictId: conflict.id,
        actorUserId: fixture.user.id,
        choice: "keep_current",
        editedProposal: null,
        rationale: "Keeping current creates no semantic change.",
      }),
    ).resolves.toMatchObject({ status: "ready" });
  });

  it("locks review state and re-reads every resolution before declaring the request ready", async () => {
    const arranged = await arrangeMerge();
    const review = first(arranged.conflicts);
    const second = mergeConflictSchema.parse({
      ...review,
      id: uuid(880),
      deltaChangeId: uuid(881),
      resolution: null,
    });
    arranged.fixture.unitOfWork.view().mergeConflicts.push(second);

    const repositories = arranged.fixture.unitOfWork.repositories;
    const originalLock = repositories.projects.lockById.bind(repositories.projects);
    const originalFind = repositories.merges.find.bind(repositories.merges);
    const originalList = repositories.merges.listConflicts.bind(repositories.merges);
    const originalSave = repositories.merges.saveResolution.bind(repositories.merges);
    let projectLocked = false;
    let conflictListReads = 0;
    repositories.projects.lockById = async (projectId) => {
      const project = await originalLock(projectId);
      projectLocked = true;
      return project;
    };
    repositories.merges.find = async (projectId, mergeRequestId) => {
      if (!projectLocked) {
        throw new Error("MergeRequest was read before the project serialization lock.");
      }
      return originalFind(projectId, mergeRequestId);
    };
    repositories.merges.listConflicts = async (projectId, mergeRequestId) => {
      conflictListReads += 1;
      return originalList(projectId, mergeRequestId);
    };
    repositories.merges.saveResolution = async (projectId, conflictId, resolution) => {
      await originalSave(projectId, conflictId, resolution);
      await originalSave(projectId, second.id, {
        ...resolution,
        rationale: "A serialized peer resolution completed before readiness was computed.",
      });
    };

    await expect(
      arranged.service.resolve({
        projectId: arranged.fixture.project.id,
        mergeRequestId: arranged.request.id,
        conflictId: review.id,
        actorUserId: arranged.fixture.user.id,
        choice: "accept_proposed",
        editedProposal: null,
        rationale: "Resolve the first review entry.",
      }),
    ).resolves.toMatchObject({ status: "ready" });
    expect(conflictListReads).toBe(2);
    expect(
      arranged.fixture.unitOfWork
        .view()
        .mergeConflicts.every((conflict) => conflict.resolution !== null),
    ).toBe(true);
  });

  it("rejects edited proposal identity changes, including edits into another slot", async () => {
    const arranged = await arrangeMerge();
    const review = first(arranged.conflicts);
    if (review.proposed === null) {
      throw new Error("The edit regression requires a proposed ContextItem.");
    }
    const occupiedSlot = mergeConflictSchema.parse({
      ...review,
      id: uuid(890),
      deltaChangeId: uuid(891),
      proposed: { ...review.proposed, key: "database.version" },
      resolution: null,
    });
    arranged.fixture.unitOfWork.view().mergeConflicts.push(occupiedSlot);
    const baseEdit: EditableContextItemProposal = {
      kind: review.proposed.kind,
      key: review.proposed.key,
      value: "PostgreSQL 18",
      scope: review.proposed.scope,
      explicitSupersedesVersionId: review.proposed.explicitSupersedesVersionId,
    };
    const attempts: readonly EditableContextItemProposal[] = [
      { ...baseEdit, key: occupiedSlot.proposed?.key ?? "database.version" },
      { ...baseEdit, kind: "assumption" },
      { ...baseEdit, scope: { component: "api", tags: [] } },
      {
        ...baseEdit,
        explicitSupersedesVersionId: contextItemVersionIdSchema.parse(uuid(892)),
      },
    ];

    for (const editedProposal of attempts) {
      await expect(
        arranged.service.resolve({
          projectId: arranged.fixture.project.id,
          mergeRequestId: arranged.request.id,
          conflictId: review.id,
          actorUserId: arranged.fixture.user.id,
          choice: "edit",
          editedProposal,
          rationale: "An edit must not move semantic identity.",
        }),
      ).rejects.toMatchObject({ code: "VALIDATION" });
    }
    expect(
      arranged.fixture.unitOfWork.view().mergeConflicts.find((entry) => entry.id === review.id)
        ?.resolution,
    ).toBeNull();
  });

  it("rejects a targeted change that would collide with another current authoritative slot", async () => {
    const fixture = createFixture();
    const { conversation, branch, message } = seedConversation(fixture);
    const now = fixture.clock.now().toISOString();
    const baseCommitId = contextCommitIdSchema.parse(uuid(900));
    const provenance = [
      {
        projectId: fixture.project.id,
        conversationId: conversation.id,
        messageIds: [message.id],
        actor: message.author,
        modelRunId: null,
        recordedAt: now,
      },
    ];
    const baseCommit = contextCommitSchema.parse({
      id: baseCommitId,
      projectId: fixture.project.id,
      kind: "semantic",
      parentCommitId: fixture.genesis.id,
      version: 1,
      idempotencyKey: "seed:two-authoritative-slots",
      summary: "Seed two distinct database slots",
      sourceDeltaIds: [uuid(901)],
      proposedBy: [{ type: "human", userId: fixture.user.id }],
      committedBy: { type: "human", userId: fixture.user.id },
      changes: [
        {
          id: uuid(902),
          ordinal: 0,
          operation: "add",
          logicalItemId: uuid(903),
          beforeVersion: null,
          afterVersion: {
            id: uuid(904),
            logicalItemId: uuid(903),
            projectId: fixture.project.id,
            commitId: baseCommitId,
            previousVersionId: null,
            kind: "fact",
            key: "database.primary",
            value: "PostgreSQL",
            scope: { component: "database", tags: [] },
            authority: "authoritative",
            confidence: 1,
            provenance,
            lifecycle: "active",
            scopeHash: "a".repeat(64),
            supersedesVersionId: null,
            createdAt: now,
          },
          sourceDeltaId: uuid(901),
          sourceDeltaChangeId: uuid(905),
        },
        {
          id: uuid(906),
          ordinal: 1,
          operation: "add",
          logicalItemId: uuid(907),
          beforeVersion: null,
          afterVersion: {
            id: uuid(908),
            logicalItemId: uuid(907),
            projectId: fixture.project.id,
            commitId: baseCommitId,
            previousVersionId: null,
            kind: "fact",
            key: "database.replica",
            value: "MySQL",
            scope: { component: "database", tags: [] },
            authority: "authoritative",
            confidence: 1,
            provenance,
            lifecycle: "active",
            scopeHash: "a".repeat(64),
            supersedesVersionId: null,
            createdAt: now,
          },
          sourceDeltaId: uuid(901),
          sourceDeltaChangeId: uuid(909),
        },
      ],
      createdAt: now,
    });
    const state = fixture.unitOfWork.view();
    state.commits.push(baseCommit);
    state.projects[0] = {
      ...fixture.project,
      headCommitId: baseCommit.id,
      version: baseCommit.version,
    };
    state.branches[0] = { ...branch, baseCommitId: baseCommit.id };
    const primary = baseCommit.changes[0]?.afterVersion;
    if (primary === undefined) {
      throw new Error("The collision fixture requires a primary ContextItem.");
    }
    const delta = contextDeltaSchema.parse({
      id: uuid(910),
      projectId: fixture.project.id,
      branchId: branch.id,
      conversationId: conversation.id,
      baseCommitId: baseCommit.id,
      throughMessageSequence: message.sequence,
      schemaVersion: 1,
      extractorRunId: null,
      revisionOf: null,
      contentHash: "b".repeat(64),
      proposedBy: { type: "human", userId: fixture.user.id },
      createdAt: now,
      changes: [
        {
          id: uuid(911),
          operation: "update",
          targetLogicalItemId: primary.logicalItemId,
          expectedBaseVersionId: primary.id,
          proposal: {
            kind: "fact",
            key: "database.replica",
            value: "CockroachDB",
            scope: { component: "database", tags: [] },
            authority: "authoritative",
            confidence: 0.9,
            provenance,
            explicitSupersedesVersionId: null,
          },
        },
      ],
    });
    fixture.unitOfWork.seedDelta(delta);
    const service = new MergeService(
      fixture.unitOfWork,
      idsFrom(920),
      fixture.clock,
      fixture.hasher,
    );
    const created = await service.create({
      projectId: fixture.project.id,
      deltaId: delta.id,
      actorUserId: fixture.user.id,
    });
    const review = first(created.conflicts);
    expect(review.classification).toBe("C0");
    await service.resolve({
      projectId: fixture.project.id,
      mergeRequestId: created.request.id,
      conflictId: review.id,
      actorUserId: fixture.user.id,
      choice: "accept_proposed",
      editedProposal: null,
      rationale: "Exercise final effective-state validation.",
    });

    await expect(
      service.finalize({
        projectId: fixture.project.id,
        mergeRequestId: created.request.id,
        actorUserId: fixture.user.id,
        expectedHeadCommitId: baseCommit.id,
        idempotencyKey: "merge:destination-slot-collision",
        summary: "Must not create a duplicate authoritative slot",
      }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    expect(fixture.unitOfWork.view().commits).toHaveLength(2);
    expect(fixture.unitOfWork.view().projects[0]?.headCommitId).toBe(baseCommit.id);
    expect(fixture.unitOfWork.view().mergeFinalizations).toHaveLength(0);
  });

  it("rebuilds edited proposals from trusted provenance and authority", async () => {
    const arranged = await arrangeMerge();
    const untrustedEdit: EditableContextItemProposal & {
      readonly authority: "alternative";
      readonly confidence: number;
      readonly provenance: readonly [];
    } = {
      kind: "fact",
      key: "database.engine",
      value: "PostgreSQL 18",
      scope: { component: "database", tags: [] },
      explicitSupersedesVersionId: null,
      authority: "alternative",
      confidence: 0,
      provenance: [],
    };

    await arranged.service.resolve({
      projectId: arranged.fixture.project.id,
      mergeRequestId: arranged.request.id,
      conflictId: first(arranged.conflicts).id,
      actorUserId: arranged.fixture.user.id,
      choice: "edit",
      editedProposal: untrustedEdit,
      rationale: "Clarify the version without changing evidence.",
    });

    const stored = arranged.fixture.unitOfWork.view().mergeConflicts[0]?.resolution?.editedProposal;
    expect(stored).toMatchObject({
      value: "PostgreSQL 18",
      authority: "authoritative",
      confidence: 0.99,
      provenance: [{ messageIds: [uuid(6)] }],
    });
  });
});
