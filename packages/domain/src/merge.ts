import { z } from "zod";

import { actorSchema } from "./actor";
import { contextItemProposalSchema, contextItemVersionSchema } from "./context-item";
import { dateTimeSchema } from "./datetime";
import { DomainError } from "./errors";
import {
  branchIdSchema,
  contextCommitIdSchema,
  contextDeltaIdSchema,
  deltaChangeIdSchema,
  mergeConflictIdSchema,
  mergeRequestIdSchema,
  projectIdSchema,
  userIdSchema,
} from "./ids";

export const conflictClassificationSchema = z.enum(["duplicate", "C0", "C1", "C2", "C3", "C4"]);
export type ConflictClassification = z.infer<typeof conflictClassificationSchema>;

export const mergeResolutionChoiceSchema = z.enum([
  "keep_current",
  "accept_proposed",
  "keep_alternative",
  "edit",
]);

export const mergeResolutionSchema = z
  .object({
    choice: mergeResolutionChoiceSchema,
    editedProposal: contextItemProposalSchema.nullable(),
    rationale: z.string().trim().min(1).max(2_000),
    resolvedBy: userIdSchema,
    resolvedAt: dateTimeSchema,
  })
  .strict()
  .superRefine((resolution, context) => {
    if ((resolution.choice === "edit") !== (resolution.editedProposal !== null)) {
      context.addIssue({
        code: "custom",
        message: "Only an edit resolution contains an edited proposal.",
        path: ["editedProposal"],
      });
    }
  });

export type MergeResolution = z.infer<typeof mergeResolutionSchema>;

export const mergeConflictSchema = z
  .object({
    id: mergeConflictIdSchema,
    projectId: projectIdSchema,
    mergeRequestId: mergeRequestIdSchema,
    deltaChangeId: deltaChangeIdSchema,
    classification: conflictClassificationSchema,
    baseVersion: contextItemVersionSchema.nullable(),
    currentVersion: contextItemVersionSchema.nullable(),
    proposed: contextItemProposalSchema.nullable(),
    reason: z.string().trim().min(1).max(2_000),
    requiresHumanReview: z.boolean(),
    resolution: mergeResolutionSchema.nullable(),
    createdAt: dateTimeSchema,
  })
  .strict()
  .superRefine((conflict, context) => {
    if (conflict.classification === "C3" && conflict.currentVersion === null) {
      context.addIssue({ code: "custom", message: "A direct conflict requires a current value." });
    }
    if (conflict.classification === "duplicate" && conflict.requiresHumanReview) {
      context.addIssue({ code: "custom", message: "A duplicate cannot require merge review." });
    }
  });

export type MergeConflict = z.infer<typeof mergeConflictSchema>;

export const mergeRequestStatusSchema = z.enum([
  "draft",
  "reviewing",
  "ready",
  "committed",
  "rejected",
  "stale",
]);

export const mergeRequestSchema = z
  .object({
    id: mergeRequestIdSchema,
    projectId: projectIdSchema,
    branchId: branchIdSchema,
    deltaId: contextDeltaIdSchema,
    baseCommitId: contextCommitIdSchema,
    evaluatedHeadCommitId: contextCommitIdSchema,
    resultingCommitId: contextCommitIdSchema.nullable(),
    status: mergeRequestStatusSchema,
    createdBy: actorSchema,
    createdAt: dateTimeSchema,
    updatedAt: dateTimeSchema,
  })
  .strict()
  .superRefine((request, context) => {
    if ((request.status === "committed") !== (request.resultingCommitId !== null)) {
      context.addIssue({
        code: "custom",
        message: "Only a committed MergeRequest has a resulting Commit.",
        path: ["resultingCommitId"],
      });
    }
  });

export type MergeRequest = z.infer<typeof mergeRequestSchema>;
export type MergeRequestStatus = z.infer<typeof mergeRequestStatusSchema>;

export const mergeFinalizationOutcomeSchema = z.enum(["committed", "no_changes"]);

export const mergeFinalizationSchema = z
  .object({
    projectId: projectIdSchema,
    mergeRequestId: mergeRequestIdSchema,
    operationKey: z.string().trim().min(1).max(200),
    outcome: mergeFinalizationOutcomeSchema,
    resultingCommitId: contextCommitIdSchema.nullable(),
    finalizedAt: dateTimeSchema,
  })
  .strict()
  .superRefine((finalization, context) => {
    if ((finalization.outcome === "committed") !== (finalization.resultingCommitId !== null)) {
      context.addIssue({
        code: "custom",
        message: "Only a committed merge finalization identifies a resulting Commit.",
        path: ["resultingCommitId"],
      });
    }
  });

export type MergeFinalization = z.infer<typeof mergeFinalizationSchema>;
export type MergeFinalizationOutcome = z.infer<typeof mergeFinalizationOutcomeSchema>;

const mergeRequestTransitions: Readonly<Record<MergeRequestStatus, readonly MergeRequestStatus[]>> =
  {
    draft: ["reviewing", "ready", "rejected", "stale"],
    reviewing: ["ready", "rejected", "stale"],
    ready: ["committed", "rejected", "stale"],
    committed: [],
    rejected: [],
    stale: [],
  };

export function assertMergeRequestTransition(
  current: MergeRequestStatus,
  next: MergeRequestStatus,
): void {
  if (!mergeRequestTransitions[current].includes(next)) {
    throw new DomainError(
      "INVALID_STATE_TRANSITION",
      `MergeRequest cannot transition from ${current} to ${next}.`,
    );
  }
}
