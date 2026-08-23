import type {
  ConflictClassification,
  ContextCommitId,
  ContextDelta,
  ContextDeltaChange,
  ContextDeltaId,
  ContextItemProposal,
  ContextItemVersion,
  ProjectId,
} from "@cce/domain";

export interface ContextSnapshot {
  readonly projectId: ProjectId;
  readonly commitId: ContextCommitId;
  readonly version: number;
  readonly items: readonly ContextItemVersion[];
  readonly ancestorCommitIds: readonly ContextCommitId[];
  readonly appliedDeltaIds: readonly ContextDeltaId[];
}

export interface CleanMergeChange {
  readonly change: ContextDeltaChange;
  readonly classification: Extract<ConflictClassification, "C0" | "C1" | "C4">;
  readonly effectiveProposal: ContextItemProposal | null;
  readonly currentVersion: ContextItemVersion | null;
  readonly requiresHumanReview: boolean;
  readonly reason: string;
}

export interface MergeConflictPlan {
  readonly change: ContextDeltaChange;
  readonly classification: Extract<ConflictClassification, "C2" | "C3">;
  readonly baseVersion: ContextItemVersion | null;
  readonly currentVersion: ContextItemVersion | null;
  readonly proposed: ContextItemProposal | null;
  readonly reason: string;
  readonly requiresHumanReview: true;
}

export interface DuplicateMergeChange {
  readonly change: ContextDeltaChange;
  readonly currentVersion: ContextItemVersion | null;
  readonly reason: string;
}

export type MergeWarningCode =
  | "STALE_BASE"
  | "BRANCH_DID_NOT_CHANGE_VALUE"
  | "TARGET_ALREADY_INACTIVE";

export interface MergeWarning {
  readonly code: MergeWarningCode;
  readonly changeId: ContextDeltaChange["id"] | null;
  readonly message: string;
}

export interface MergePlan {
  readonly projectId: ProjectId;
  readonly delta: ContextDelta;
  readonly baseCommitId: ContextCommitId;
  readonly evaluatedHeadCommitId: ContextCommitId;
  readonly cleanChanges: readonly CleanMergeChange[];
  readonly conflicts: readonly MergeConflictPlan[];
  readonly duplicates: readonly DuplicateMergeChange[];
  readonly warnings: readonly MergeWarning[];
  readonly requiresHumanReview: boolean;
}

