import {
  contextDeltaSchema,
  contextItemVersionSchema,
  DomainError,
  isHighRiskContextKind,
  type ContextDelta,
  type ContextDeltaChange,
  type ContextItemProposal,
  type ContextItemVersion,
} from "@cce/domain";

import { mergeCompatibleJson, normalizedJsonEquals } from "./canonical-json";
import type {
  CleanMergeChange,
  ContextSnapshot,
  DuplicateMergeChange,
  MergeConflictPlan,
  MergePlan,
  MergeWarning,
} from "./merge-types";
import { sameContextSlot, scopeIdentity, scopesAreDisjoint } from "./scope";

const compatibleExpansionKinds = new Set<ContextItemVersion["kind"]>([
  "fact",
  "artifact",
  "risk",
]);

interface MergeAccumulator {
  cleanChanges: CleanMergeChange[];
  conflicts: MergeConflictPlan[];
  duplicates: DuplicateMergeChange[];
  warnings: MergeWarning[];
}

function validateSnapshot(snapshot: ContextSnapshot): ContextSnapshot {
  const items = contextItemVersionSchema.array().parse(snapshot.items);
  if (items.some((item) => item.projectId !== snapshot.projectId)) {
    throw new DomainError(
      "PROJECT_SCOPE_MISMATCH",
      "Every snapshot item must belong to the snapshot project.",
    );
  }
  return { ...snapshot, items };
}

function proposalFrom(change: ContextDeltaChange): ContextItemProposal | null {
  return change.operation === "deprecate" ? null : change.proposal;
}

function findByLogicalItem(
  items: readonly ContextItemVersion[],
  logicalItemId: ContextItemVersion["logicalItemId"],
): ContextItemVersion | null {
  return items.find((item) => item.logicalItemId === logicalItemId) ?? null;
}

function sameProposalValue(
  version: ContextItemVersion,
  proposal: ContextItemProposal,
): boolean {
  return (
    version.kind === proposal.kind &&
    version.key === proposal.key &&
    version.authority === proposal.authority &&
    scopeIdentity(version.scope) === scopeIdentity(proposal.scope) &&
    normalizedJsonEquals(version.value, proposal.value)
  );
}

function conflictClassification(
  current: ContextItemVersion,
  proposal: ContextItemProposal,
): "C2" | "C3" {
  if (current.key !== proposal.key || current.kind !== proposal.kind) {
    return "C2";
  }
  if (scopesAreDisjoint(current.scope, proposal.scope)) {
    return "C2";
  }
  if (
    current.authority === "authoritative" &&
    proposal.authority === "authoritative" &&
    (isHighRiskContextKind(current.kind) || scopeIdentity(current.scope) === scopeIdentity(proposal.scope))
  ) {
    return "C3";
  }
  return "C2";
}

function addClean(
  accumulator: MergeAccumulator,
  change: ContextDeltaChange,
  classification: CleanMergeChange["classification"],
  proposal: ContextItemProposal | null,
  currentVersion: ContextItemVersion | null,
  reason: string,
): void {
  const kind = proposal?.kind ?? currentVersion?.kind;
  accumulator.cleanChanges.push({
    change,
    classification,
    effectiveProposal: proposal,
    currentVersion,
    requiresHumanReview: kind === undefined ? true : isHighRiskContextKind(kind),
    reason,
  });
}

function addConflict(
  accumulator: MergeAccumulator,
  change: ContextDeltaChange,
  classification: "C2" | "C3",
  baseVersion: ContextItemVersion | null,
  currentVersion: ContextItemVersion | null,
  reason: string,
): void {
  accumulator.conflicts.push({
    change,
    classification,
    baseVersion,
    currentVersion,
    proposed: proposalFrom(change),
    reason,
    requiresHumanReview: true,
  });
}

function mergeAdd(
  change: Extract<ContextDeltaChange, { operation: "add" }>,
  currentItems: readonly ContextItemVersion[],
  accumulator: MergeAccumulator,
): void {
  const sameKeyCandidates = currentItems.filter(
    (item) =>
      item.lifecycle === "active" && item.kind === change.proposal.kind && item.key === change.proposal.key,
  );
  const sameSlot = sameKeyCandidates.find((item) => sameContextSlot(item, change.proposal));

  if (sameSlot === undefined) {
    const overlapping = sameKeyCandidates.find(
      (item) => !scopesAreDisjoint(item.scope, change.proposal.scope),
    );
    if (overlapping !== undefined) {
      addConflict(
        accumulator,
        change,
        "C2",
        null,
        overlapping,
        "The same key has an overlapping but non-identical scope.",
      );
      return;
    }
    addClean(accumulator, change, "C0", change.proposal, null, "No current item occupies this key and scope.");
    return;
  }

  if (sameProposalValue(sameSlot, change.proposal)) {
    accumulator.duplicates.push({
      change,
      currentVersion: sameSlot,
      reason: "The proposed semantic value already exists.",
    });
    return;
  }

  if (change.proposal.explicitSupersedesVersionId === sameSlot.id) {
    addClean(
      accumulator,
      change,
      "C4",
      change.proposal,
      sameSlot,
      "The proposal explicitly supersedes the current version.",
    );
    return;
  }

  if (compatibleExpansionKinds.has(change.proposal.kind)) {
    const expansion = mergeCompatibleJson(sameSlot.value, change.proposal.value);
    if (expansion.compatible) {
      addClean(
        accumulator,
        change,
        "C1",
        { ...change.proposal, value: expansion.value },
        sameSlot,
        "An allow-listed value expansion can be combined deterministically.",
      );
      return;
    }
  }

  addConflict(
    accumulator,
    change,
    conflictClassification(sameSlot, change.proposal),
    null,
    sameSlot,
    "The proposal competes with an existing value for the same context slot.",
  );
}

function mergeTargetedChange(
  change: Exclude<ContextDeltaChange, { operation: "add" }>,
  baseItems: readonly ContextItemVersion[],
  currentItems: readonly ContextItemVersion[],
  accumulator: MergeAccumulator,
): void {
  const baseVersion = findByLogicalItem(baseItems, change.targetLogicalItemId);
  if (baseVersion === null || baseVersion.id !== change.expectedBaseVersionId) {
    addConflict(
      accumulator,
      change,
      "C2",
      baseVersion,
      findByLogicalItem(currentItems, change.targetLogicalItemId),
      "The target does not match the version recorded at the Branch base.",
    );
    return;
  }

  const currentVersion = findByLogicalItem(currentItems, change.targetLogicalItemId);
  if (currentVersion === null || currentVersion.lifecycle !== "active") {
    accumulator.duplicates.push({
      change,
      currentVersion,
      reason: "The target is already absent or inactive at current HEAD.",
    });
    accumulator.warnings.push({
      code: "TARGET_ALREADY_INACTIVE",
      changeId: change.id,
      message: "The requested target is already absent or inactive.",
    });
    return;
  }

  if (change.operation === "deprecate") {
    if (currentVersion.id === change.expectedBaseVersionId) {
      addClean(accumulator, change, "C4", null, currentVersion, "The current version can be explicitly deprecated.");
    } else {
      addConflict(
        accumulator,
        change,
        "C2",
        baseVersion,
        currentVersion,
        "The target changed after the Branch base; deprecation requires review.",
      );
    }
    return;
  }

  if (sameProposalValue(currentVersion, change.proposal)) {
    accumulator.duplicates.push({
      change,
      currentVersion,
      reason: "The current HEAD already contains the proposed value.",
    });
    return;
  }

  if (currentVersion.id === change.expectedBaseVersionId) {
    const classification = change.operation === "supersede" ? "C4" : "C0";
    addClean(
      accumulator,
      change,
      classification,
      change.proposal,
      currentVersion,
      change.operation === "supersede"
        ? "The proposal explicitly supersedes the unchanged base version."
        : "The target has not changed since the Branch base.",
    );
    return;
  }

  if (sameProposalValue(baseVersion, change.proposal)) {
    accumulator.duplicates.push({
      change,
      currentVersion,
      reason: "The Branch proposes its unchanged base value and cannot roll back current HEAD.",
    });
    accumulator.warnings.push({
      code: "BRANCH_DID_NOT_CHANGE_VALUE",
      changeId: change.id,
      message: "The proposal equals Base while current HEAD has moved; no rollback was applied.",
    });
    return;
  }

  if (compatibleExpansionKinds.has(change.proposal.kind)) {
    const expansion = mergeCompatibleJson(currentVersion.value, change.proposal.value);
    if (expansion.compatible && sameContextSlot(currentVersion, change.proposal)) {
      addClean(
        accumulator,
        change,
        "C1",
        { ...change.proposal, value: expansion.value },
        currentVersion,
        "Concurrent allow-listed expansions can be combined deterministically.",
      );
      return;
    }
  }

  addConflict(
    accumulator,
    change,
    conflictClassification(currentVersion, change.proposal),
    baseVersion,
    currentVersion,
    "Both the Branch proposal and current HEAD changed from Base.",
  );
}

export function createThreeWayMergePlan(
  untrustedDelta: ContextDelta,
  untrustedBase: ContextSnapshot,
  untrustedCurrent: ContextSnapshot,
): MergePlan {
  const delta = contextDeltaSchema.parse(untrustedDelta);
  const base = validateSnapshot(untrustedBase);
  const current = validateSnapshot(untrustedCurrent);

  if (delta.projectId !== base.projectId || delta.projectId !== current.projectId) {
    throw new DomainError(
      "PROJECT_SCOPE_MISMATCH",
      "Delta, Base, and Current snapshots must belong to one project.",
    );
  }
  if (delta.baseCommitId !== base.commitId) {
    throw new DomainError(
      "INVARIANT_VIOLATION",
      "The supplied Base snapshot does not match the Delta base commit.",
    );
  }
  if (
    base.commitId !== current.commitId &&
    !current.ancestorCommitIds.includes(base.commitId)
  ) {
    throw new DomainError(
      "INVARIANT_VIOLATION",
      "The Delta base is not an ancestor of current canonical HEAD.",
    );
  }

  const accumulator: MergeAccumulator = {
    cleanChanges: [],
    conflicts: [],
    duplicates: [],
    warnings: [],
  };

  if (current.appliedDeltaIds.includes(delta.id)) {
    accumulator.duplicates.push(
      ...delta.changes.map((change) => ({
        change,
        currentVersion: null,
        reason: "This Delta has already been applied.",
      })),
    );
  } else {
    if (base.commitId !== current.commitId) {
      accumulator.warnings.push({
        code: "STALE_BASE",
        changeId: null,
        message: "The Branch base is stale, so the plan was evaluated as a three-way merge.",
      });
    }
    for (const change of delta.changes) {
      if (change.operation === "add") {
        mergeAdd(change, current.items, accumulator);
      } else {
        mergeTargetedChange(change, base.items, current.items, accumulator);
      }
    }
  }

  return {
    projectId: delta.projectId,
    delta,
    baseCommitId: base.commitId,
    evaluatedHeadCommitId: current.commitId,
    cleanChanges: accumulator.cleanChanges,
    conflicts: accumulator.conflicts,
    duplicates: accumulator.duplicates,
    warnings: accumulator.warnings,
    requiresHumanReview:
      accumulator.conflicts.length > 0 ||
      accumulator.cleanChanges.some((change) => change.requiresHumanReview),
  };
}

