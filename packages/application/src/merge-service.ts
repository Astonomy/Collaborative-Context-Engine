import type { Clock, ContentHasher, IdGenerator } from "@cce/shared";
import {
  assertHighRiskApproval,
  auditEventIdSchema,
  commitChangeIdSchema,
  contextCommitChangeSchema,
  contextCommitIdSchema,
  contextCommitSchema,
  contextItemProposalSchema,
  contextItemVersionIdSchema,
  contextItemVersionSchema,
  isHighRiskContextKind,
  logicalContextItemIdSchema,
  mergeConflictIdSchema,
  mergeConflictSchema,
  mergeFinalizationSchema,
  mergeRequestIdSchema,
  mergeRequestSchema,
  mergeResolutionSchema,
  type ContextCommit,
  type ContextDeltaChange,
  type ContextItemProposal,
  type ContextItemVersion,
  type MergeConflict,
  type MergeFinalization,
  type MergeRequest,
  type MergeResolution,
  type ProjectId,
  type UserId,
} from "@cce/domain";
import {
  createThreeWayMergePlan,
  scopeIdentity,
  type CleanMergeChange,
  type MergeConflictPlan,
  type MergePlan,
} from "@cce/context-engine";

import { authorizeProjectMember, requireActiveProject } from "./authorization";
import { ApplicationError } from "./errors";
import type { CceRepositories, UnitOfWork } from "./repositories";

interface FinalizeResult {
  readonly outcome: "committed" | "no_changes";
  readonly commit: ContextCommit | null;
}

export type EditableContextItemProposal = Pick<
  ContextItemProposal,
  "kind" | "key" | "value" | "scope" | "explicitSupersedesVersionId"
>;

function proposalForReview(
  entry: CleanMergeChange | MergeConflictPlan,
): ContextItemProposal | null {
  return "effectiveProposal" in entry ? entry.effectiveProposal : entry.proposed;
}

function currentForReview(entry: CleanMergeChange | MergeConflictPlan): ContextItemVersion | null {
  return entry.currentVersion;
}

export class MergeService {
  public constructor(
    private readonly unitOfWork: UnitOfWork,
    private readonly ids: IdGenerator,
    private readonly clock: Clock,
    private readonly hasher: ContentHasher,
  ) {}

  public async create(input: {
    readonly projectId: ProjectId;
    readonly deltaId: Parameters<CceRepositories["context"]["findDelta"]>[1];
    readonly actorUserId: UserId;
  }): Promise<{ readonly request: MergeRequest; readonly conflicts: readonly MergeConflict[] }> {
    const requestId = mergeRequestIdSchema.parse(this.ids.next());
    const eventId = auditEventIdSchema.parse(this.ids.next());
    const now = this.clock.now().toISOString();

    return this.unitOfWork.run(async (repositories) => {
      const access = await repositories.projects.findAccess(input.projectId, input.actorUserId);
      authorizeProjectMember(access?.member ?? null, input.actorUserId, "context:propose");
      if (access === null) {
        throw new ApplicationError("NOT_FOUND", "Project was not found.");
      }
      requireActiveProject(access.project);
      const delta = await repositories.context.findDelta(input.projectId, input.deltaId);
      if (delta === null) {
        throw new ApplicationError("NOT_FOUND", "ContextDelta was not found.");
      }
      const [base, current] = await Promise.all([
        repositories.context.getSnapshot(input.projectId, delta.baseCommitId),
        repositories.context.getHeadSnapshot(input.projectId),
      ]);
      if (base === null || current === null) {
        throw new ApplicationError("CONFLICT", "Required Context snapshots are unavailable.");
      }
      const plan = createThreeWayMergePlan(delta, base, current);
      const reviewEntries: readonly (CleanMergeChange | MergeConflictPlan)[] = [
        ...plan.cleanChanges,
        ...plan.conflicts,
      ];
      const conflicts = reviewEntries.map((entry) =>
        mergeConflictSchema.parse({
          id: mergeConflictIdSchema.parse(this.ids.next()),
          projectId: input.projectId,
          mergeRequestId: requestId,
          deltaChangeId: entry.change.id,
          classification: entry.classification,
          baseVersion: "baseVersion" in entry ? entry.baseVersion : null,
          currentVersion: currentForReview(entry),
          proposed: proposalForReview(entry),
          reason: entry.reason,
          requiresHumanReview: true,
          resolution: null,
          createdAt: now,
        }),
      );
      const request = mergeRequestSchema.parse({
        id: requestId,
        projectId: input.projectId,
        branchId: delta.branchId,
        deltaId: delta.id,
        baseCommitId: delta.baseCommitId,
        evaluatedHeadCommitId: current.commitId,
        resultingCommitId: null,
        status: conflicts.length === 0 ? "ready" : "reviewing",
        createdBy: { type: "human", userId: input.actorUserId },
        createdAt: now,
        updatedAt: now,
      });
      await repositories.merges.insert(request, conflicts);
      await repositories.audit.append({
        id: eventId,
        projectId: input.projectId,
        actor: { type: "human", userId: input.actorUserId },
        action: "merge_request.created",
        targetType: "merge_request",
        targetId: requestId,
        metadata: {
          cleanChanges: plan.cleanChanges.length,
          conflicts: plan.conflicts.length,
          duplicates: plan.duplicates.length,
        },
        occurredAt: now,
      });
      return { request, conflicts };
    });
  }

  public async resolve(input: {
    readonly projectId: ProjectId;
    readonly mergeRequestId: MergeRequest["id"];
    readonly conflictId: MergeConflict["id"];
    readonly actorUserId: UserId;
    readonly choice: MergeResolution["choice"];
    readonly editedProposal: EditableContextItemProposal | null;
    readonly rationale: string;
  }): Promise<MergeRequest> {
    const now = this.clock.now().toISOString();
    const eventId = auditEventIdSchema.parse(this.ids.next());

    return this.unitOfWork.run(async (repositories) => {
      const project = await repositories.projects.lockById(input.projectId);
      if (project === null) {
        throw new ApplicationError("NOT_FOUND", "Project was not found.");
      }
      const access = await repositories.projects.findAccess(input.projectId, input.actorUserId);
      authorizeProjectMember(access?.member ?? null, input.actorUserId, "context:review_low_risk");
      requireActiveProject(project);
      const request = await repositories.merges.find(input.projectId, input.mergeRequestId);
      if (request === null || !["draft", "reviewing"].includes(request.status)) {
        throw new ApplicationError("CONFLICT", "MergeRequest is not open for review.");
      }
      const conflicts = await repositories.merges.listConflicts(input.projectId, request.id);
      const conflict = conflicts.find((entry) => entry.id === input.conflictId);
      if (conflict === undefined) {
        throw new ApplicationError("NOT_FOUND", "Merge review entry was not found.");
      }
      const editedProposal =
        input.editedProposal === null
          ? null
          : this.rebuildTrustedEdit(input.editedProposal, conflict);
      const resolution = mergeResolutionSchema.parse({
        choice: input.choice,
        editedProposal,
        rationale: input.rationale,
        resolvedBy: input.actorUserId,
        resolvedAt: now,
      });
      if (this.resolutionIncludesHighRisk(conflict, resolution)) {
        authorizeProjectMember(
          access?.member ?? null,
          input.actorUserId,
          "context:approve_high_risk",
        );
      }
      await repositories.merges.saveResolution(input.projectId, conflict.id, resolution);
      const refreshedConflicts = await repositories.merges.listConflicts(
        input.projectId,
        request.id,
      );
      const remaining = refreshedConflicts.some((entry) => entry.resolution === null);
      const updated = mergeRequestSchema.parse({
        ...request,
        status: remaining ? "reviewing" : "ready",
        updatedAt: now,
      });
      await repositories.merges.updateRequest(updated);
      await repositories.audit.append({
        id: eventId,
        projectId: input.projectId,
        actor: { type: "human", userId: input.actorUserId },
        action: "merge_conflict.resolved",
        targetType: "merge_conflict",
        targetId: conflict.id,
        metadata: { choice: resolution.choice, mergeRequestId: request.id },
        occurredAt: now,
      });
      return updated;
    });
  }

  private rebuildTrustedEdit(
    edit: EditableContextItemProposal,
    conflict: MergeConflict,
  ): ContextItemProposal {
    if (conflict.proposed === null) {
      throw new ApplicationError(
        "VALIDATION",
        "A deprecation review cannot be converted into an edited proposal.",
      );
    }
    if (
      edit.kind !== conflict.proposed.kind ||
      edit.key !== conflict.proposed.key ||
      scopeIdentity(edit.scope) !== scopeIdentity(conflict.proposed.scope) ||
      edit.explicitSupersedesVersionId !== conflict.proposed.explicitSupersedesVersionId
    ) {
      throw new ApplicationError(
        "VALIDATION",
        "An edited proposal may change only the value; kind, key, scope, and supersession target are immutable.",
      );
    }
    return contextItemProposalSchema.parse({
      kind: conflict.proposed.kind,
      key: conflict.proposed.key,
      value: edit.value,
      scope: conflict.proposed.scope,
      explicitSupersedesVersionId: conflict.proposed.explicitSupersedesVersionId,
      authority: conflict.proposed.authority,
      confidence: conflict.proposed.confidence,
      provenance: conflict.proposed.provenance,
    });
  }

  public async finalize(input: {
    readonly projectId: ProjectId;
    readonly mergeRequestId: MergeRequest["id"];
    readonly actorUserId: UserId;
    readonly expectedHeadCommitId: MergeRequest["evaluatedHeadCommitId"];
    readonly idempotencyKey: string;
    readonly summary: string;
  }): Promise<FinalizeResult> {
    const normalizedClientKey = input.idempotencyKey.trim();
    if (normalizedClientKey.length === 0 || normalizedClientKey.length > 200) {
      throw new ApplicationError("VALIDATION", "Idempotency-Key must contain 1 to 200 characters.");
    }
    const operationKey = `merge:${input.mergeRequestId}:${this.hasher.sha256(normalizedClientKey)}`;
    const commitId = contextCommitIdSchema.parse(this.ids.next());
    const eventId = auditEventIdSchema.parse(this.ids.next());
    const now = this.clock.now().toISOString();

    return this.unitOfWork.run(async (repositories) => {
      const project = await repositories.projects.lockById(input.projectId);
      if (project === null) {
        throw new ApplicationError("NOT_FOUND", "Project was not found.");
      }
      const access = await repositories.projects.findAccess(input.projectId, input.actorUserId);
      authorizeProjectMember(access?.member ?? null, input.actorUserId, "context:review_low_risk");
      const request = await repositories.merges.find(input.projectId, input.mergeRequestId);
      if (request === null) {
        throw new ApplicationError("NOT_FOUND", "MergeRequest was not found.");
      }
      const initialConflicts = await repositories.merges.listConflicts(input.projectId, request.id);
      if (initialConflicts.some((conflict) => conflict.resolution === null)) {
        throw new ApplicationError("CONFLICT", "Every merge review entry must be resolved.");
      }
      this.authorizeResolvedChanges(access?.member ?? null, input.actorUserId, initialConflicts);
      const finalization = await repositories.merges.findFinalization(input.projectId, request.id);
      if (finalization !== null) {
        return this.loadFinalizedRetry(repositories, request, finalization, operationKey);
      }
      requireActiveProject(project);
      if (request.status !== "ready") {
        throw new ApplicationError("CONFLICT", "MergeRequest is not ready to finalize.");
      }
      if (
        project.headCommitId !== input.expectedHeadCommitId ||
        request.evaluatedHeadCommitId !== input.expectedHeadCommitId
      ) {
        throw new ApplicationError(
          "CONFLICT",
          "Project Context HEAD changed; recompute the merge.",
        );
      }
      const existing = await repositories.context.findCommitByIdempotencyKey(
        input.projectId,
        operationKey,
      );
      if (existing !== null) {
        throw new ApplicationError(
          "CONFLICT",
          "The merge idempotency record is inconsistent with the MergeRequest state.",
        );
      }
      const delta = await repositories.context.findDelta(input.projectId, request.deltaId);
      const [base, current, conflicts] = await Promise.all([
        repositories.context.getSnapshot(input.projectId, request.baseCommitId),
        repositories.context.getHeadSnapshot(input.projectId),
        repositories.merges.listConflicts(input.projectId, request.id),
      ]);
      if (delta === null || base === null || current === null) {
        throw new ApplicationError("CONFLICT", "Merge inputs are no longer available.");
      }
      if (conflicts.some((conflict) => conflict.resolution === null)) {
        throw new ApplicationError("CONFLICT", "Every merge review entry must be resolved.");
      }
      this.authorizeResolvedChanges(access?.member ?? null, input.actorUserId, conflicts);
      const plan = createThreeWayMergePlan(delta, base, current);
      const changes = this.materializeChanges(plan, conflicts, commitId, input.actorUserId, now);
      this.assertUniqueEffectiveAuthoritativeSlots(current.items, changes);

      if (changes.length === 0) {
        const rejected = mergeRequestSchema.parse({
          ...request,
          status: "rejected",
          updatedAt: now,
        });
        await repositories.merges.insertFinalization(
          mergeFinalizationSchema.parse({
            projectId: input.projectId,
            mergeRequestId: request.id,
            operationKey,
            outcome: "no_changes",
            resultingCommitId: null,
            finalizedAt: now,
          }),
        );
        await repositories.merges.updateRequest(rejected);
        await repositories.audit.append({
          id: eventId,
          projectId: input.projectId,
          actor: { type: "human", userId: input.actorUserId },
          action: "merge_request.closed_without_changes",
          targetType: "merge_request",
          targetId: request.id,
          metadata: {},
          occurredAt: now,
        });
        return { outcome: "no_changes", commit: null };
      }

      const commit = contextCommitSchema.parse({
        id: commitId,
        projectId: input.projectId,
        kind: "semantic",
        parentCommitId: project.headCommitId,
        version: project.version + 1,
        idempotencyKey: operationKey,
        summary: input.summary,
        sourceDeltaIds: [delta.id],
        proposedBy: [delta.proposedBy],
        committedBy: { type: "human", userId: input.actorUserId },
        changes,
        createdAt: now,
      });
      await repositories.context.insertCommit(commit);
      await repositories.context.applyProjectionChanges(input.projectId, commit.changes);
      const advanced = await repositories.projects.advanceHead(
        input.projectId,
        project.headCommitId,
        commit.id,
        commit.version,
      );
      if (!advanced) {
        throw new ApplicationError("CONFLICT", "Project Context HEAD changed during commit.");
      }
      await repositories.merges.updateRequest(
        mergeRequestSchema.parse({
          ...request,
          status: "committed",
          resultingCommitId: commit.id,
          updatedAt: now,
        }),
      );
      await repositories.merges.insertFinalization(
        mergeFinalizationSchema.parse({
          projectId: input.projectId,
          mergeRequestId: request.id,
          operationKey,
          outcome: "committed",
          resultingCommitId: commit.id,
          finalizedAt: now,
        }),
      );
      await repositories.audit.append({
        id: eventId,
        projectId: input.projectId,
        actor: { type: "human", userId: input.actorUserId },
        action: "context_commit.created",
        targetType: "context_commit",
        targetId: commit.id,
        metadata: { mergeRequestId: request.id, version: commit.version },
        occurredAt: now,
      });
      return { outcome: "committed", commit };
    });
  }

  private authorizeResolvedChanges(
    member: Parameters<typeof authorizeProjectMember>[0],
    actorUserId: UserId,
    conflicts: readonly MergeConflict[],
  ): void {
    const includesHighRiskChange = conflicts.some(
      (conflict) =>
        conflict.resolution !== null &&
        this.resolutionIncludesHighRisk(conflict, conflict.resolution),
    );
    if (includesHighRiskChange) {
      authorizeProjectMember(member, actorUserId, "context:approve_high_risk");
    }
  }

  private assertUniqueEffectiveAuthoritativeSlots(
    currentItems: readonly ContextItemVersion[],
    changes: readonly ContextCommit["changes"][number][],
  ): void {
    const effectiveByLineage = new Map(
      currentItems.map((item) => [item.logicalItemId, item] as const),
    );
    for (const change of changes) {
      effectiveByLineage.set(change.logicalItemId, change.afterVersion);
    }

    const lineageBySlot = new Map<string, ContextItemVersion["logicalItemId"]>();
    for (const item of effectiveByLineage.values()) {
      if (item.lifecycle !== "active" || item.authority !== "authoritative") {
        continue;
      }
      const slot = `${item.kind}:${item.key}:${scopeIdentity(item.scope)}`;
      const occupyingLineage = lineageBySlot.get(slot);
      if (occupyingLineage !== undefined && occupyingLineage !== item.logicalItemId) {
        throw new ApplicationError(
          "CONFLICT",
          `The resolved merge would create multiple active authoritative values for ${item.kind}:${item.key} in the same scope.`,
        );
      }
      lineageBySlot.set(slot, item.logicalItemId);
    }
  }

  private resolutionIncludesHighRisk(
    conflict: MergeConflict,
    resolution: MergeResolution,
  ): boolean {
    let kinds: readonly (ContextItemVersion["kind"] | undefined)[];
    switch (resolution.choice) {
      case "keep_current":
        kinds = [];
        break;
      case "keep_alternative":
        kinds = [conflict.proposed?.kind];
        break;
      case "edit":
        kinds = [conflict.currentVersion?.kind, resolution.editedProposal?.kind];
        break;
      case "accept_proposed":
        kinds = [conflict.currentVersion?.kind, conflict.proposed?.kind];
        break;
    }
    return kinds.some((kind) => kind !== undefined && isHighRiskContextKind(kind));
  }

  private async loadFinalizedRetry(
    repositories: CceRepositories,
    request: MergeRequest,
    finalization: MergeFinalization,
    operationKey: string,
  ): Promise<FinalizeResult> {
    if (finalization.operationKey !== operationKey) {
      throw new ApplicationError(
        "CONFLICT",
        "This MergeRequest was already finalized with a different idempotency key.",
      );
    }
    if (finalization.outcome === "no_changes") {
      if (request.status !== "rejected" || request.resultingCommitId !== null) {
        throw new ApplicationError(
          "CONFLICT",
          "The no-change finalization record is inconsistent with the MergeRequest state.",
        );
      }
      return { outcome: "no_changes", commit: null };
    }
    const existing = await repositories.context.findCommitByIdempotencyKey(
      request.projectId,
      operationKey,
    );
    if (
      existing === null ||
      finalization.resultingCommitId === null ||
      request.resultingCommitId === null ||
      finalization.resultingCommitId !== request.resultingCommitId ||
      existing.id !== request.resultingCommitId ||
      existing.kind !== "semantic" ||
      !existing.sourceDeltaIds.includes(request.deltaId)
    ) {
      throw new ApplicationError(
        "CONFLICT",
        "The idempotency key does not identify this committed MergeRequest.",
      );
    }
    return { outcome: "committed", commit: existing };
  }

  private materializeChanges(
    plan: MergePlan,
    conflicts: readonly MergeConflict[],
    commitId: ContextCommit["id"],
    actorUserId: UserId,
    createdAt: string,
  ): readonly ContextCommit["changes"][number][] {
    const resolutionByChange = new Map(
      conflicts.map((conflict) => [conflict.deltaChangeId, conflict.resolution]),
    );
    const planEntries: readonly (CleanMergeChange | MergeConflictPlan)[] = [
      ...plan.cleanChanges,
      ...plan.conflicts,
    ];
    const materialized: ContextCommit["changes"][number][] = [];

    for (const entry of planEntries) {
      const resolution = resolutionByChange.get(entry.change.id);
      if (resolution === undefined || resolution === null) {
        throw new ApplicationError("CONFLICT", "Merge plan and stored review entries diverged.");
      }
      if (resolution.choice === "keep_current") {
        continue;
      }
      const current = currentForReview(entry);
      const originalProposal = proposalForReview(entry);
      const selectedProposal =
        resolution.choice === "edit" ? resolution.editedProposal : originalProposal;
      const keepAlternative = resolution.choice === "keep_alternative";

      if (entry.change.operation === "deprecate" && keepAlternative) {
        throw new ApplicationError(
          "VALIDATION",
          "A deprecation cannot be resolved by keeping an alternative.",
        );
      }

      if (entry.change.operation !== "deprecate" && selectedProposal === null) {
        throw new ApplicationError("VALIDATION", "The selected merge action has no proposal.");
      }
      const change = this.materializeChange({
        deltaId: plan.delta.id,
        source: entry.change,
        current,
        selectedProposal,
        keepAlternative,
        commitId,
        actorUserId,
        createdAt,
        ordinal: materialized.length,
      });
      materialized.push(change);
    }
    return materialized;
  }

  private materializeChange(input: {
    readonly deltaId: MergePlan["delta"]["id"];
    readonly source: ContextDeltaChange;
    readonly current: ContextItemVersion | null;
    readonly selectedProposal: ContextItemProposal | null;
    readonly keepAlternative: boolean;
    readonly commitId: ContextCommit["id"];
    readonly actorUserId: UserId;
    readonly createdAt: string;
    readonly ordinal: number;
  }): ContextCommit["changes"][number] {
    const alternativeLineage = input.keepAlternative || input.current === null;
    const logicalItemId = alternativeLineage
      ? logicalContextItemIdSchema.parse(this.ids.next())
      : input.current.logicalItemId;
    const beforeVersion = alternativeLineage ? null : input.current;
    let operation: ContextCommit["changes"][number]["operation"];
    if (input.keepAlternative || input.current === null) {
      operation = "add";
    } else if (input.source.operation === "deprecate") {
      operation = "deprecate";
    } else if (
      input.source.operation === "supersede" ||
      input.selectedProposal?.explicitSupersedesVersionId === input.current.id
    ) {
      operation = "supersede";
    } else {
      operation = "update";
    }

    let afterVersion: ContextItemVersion;
    if (input.source.operation === "deprecate") {
      if (input.current === null) {
        throw new ApplicationError("CONFLICT", "Cannot deprecate a missing ContextItem.");
      }
      afterVersion = contextItemVersionSchema.parse({
        ...input.current,
        id: contextItemVersionIdSchema.parse(this.ids.next()),
        commitId: input.commitId,
        previousVersionId: input.current.id,
        lifecycle: "deprecated",
        provenance: [...input.current.provenance, ...input.source.provenance],
        supersedesVersionId: null,
        createdAt: input.createdAt,
      });
    } else {
      if (input.selectedProposal === null) {
        throw new ApplicationError("VALIDATION", "A semantic change requires a proposal.");
      }
      const proposal = input.keepAlternative
        ? { ...input.selectedProposal, authority: "alternative" as const }
        : input.selectedProposal;
      assertHighRiskApproval(proposal.kind, { type: "human", userId: input.actorUserId });
      afterVersion = contextItemVersionSchema.parse({
        id: contextItemVersionIdSchema.parse(this.ids.next()),
        logicalItemId,
        projectId: planProjectId(proposal, input.current),
        commitId: input.commitId,
        previousVersionId: beforeVersion?.id ?? null,
        kind: proposal.kind,
        key: proposal.key,
        value: proposal.value,
        scope: proposal.scope,
        authority: proposal.authority,
        confidence: proposal.confidence,
        provenance: proposal.provenance,
        lifecycle: "active",
        scopeHash: this.hasher.sha256(scopeIdentity(proposal.scope)),
        supersedesVersionId: operation === "supersede" ? (input.current?.id ?? null) : null,
        createdAt: input.createdAt,
      });
    }

    return contextCommitChangeSchema.parse({
      id: commitChangeIdSchema.parse(this.ids.next()),
      ordinal: input.ordinal,
      operation,
      logicalItemId,
      beforeVersion,
      afterVersion,
      sourceDeltaId: input.deltaId,
      sourceDeltaChangeId: input.source.id,
    });
  }
}

function planProjectId(
  proposal: ContextItemProposal,
  current: ContextItemVersion | null,
): ContextItemVersion["projectId"] {
  return current?.projectId ?? proposal.provenance[0]?.projectId ?? missingProject();
}

function missingProject(): never {
  throw new ApplicationError("VALIDATION", "A proposal must preserve project provenance.");
}
