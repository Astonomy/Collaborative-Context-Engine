import {
  contextCommitIdSchema,
  contextCommitSchema,
  contextItemProposalSchema,
  contextDeltaIdSchema,
  mergeConflictIdSchema,
  mergeConflictSchema,
  mergeRequestIdSchema,
  mergeRequestSchema,
  mergeResolutionChoiceSchema,
  projectIdSchema,
} from "@cce/domain";
import { z } from "zod";

export const mergeRequestPathParamsSchema = z
  .object({
    projectId: projectIdSchema,
    mergeRequestId: mergeRequestIdSchema,
  })
  .strict();

export const mergeConflictPathParamsSchema = mergeRequestPathParamsSchema
  .extend({ conflictId: mergeConflictIdSchema })
  .strict();

export const createMergeRequestBodySchema = z
  .object({
    deltaId: contextDeltaIdSchema,
  })
  .strict();

export const editableContextItemProposalSchema = contextItemProposalSchema
  .pick({
    kind: true,
    key: true,
    value: true,
    scope: true,
    explicitSupersedesVersionId: true,
  })
  .strict();

export const resolveMergeConflictBodySchema = z
  .object({
    choice: mergeResolutionChoiceSchema,
    editedProposal: editableContextItemProposalSchema.nullable().default(null),
    rationale: z.string().trim().min(1).max(2_000),
  })
  .strict()
  .superRefine((resolution, context) => {
    if ((resolution.choice === "edit") !== (resolution.editedProposal !== null)) {
      context.addIssue({
        code: "custom",
        message: "Only an edit resolution may contain an edited proposal.",
        path: ["editedProposal"],
      });
    }
  });

export const finalizeMergeRequestBodySchema = z
  .object({
    expectedHeadCommitId: contextCommitIdSchema,
    summary: z.string().trim().min(1).max(500),
  })
  .strict();

export const finalizeMergeRequestHeadersSchema = z
  .object({
    "idempotency-key": z.string().trim().min(1).max(200),
  })
  .strict();

export const mergeRequestDetailResponseSchema = z
  .object({
    request: mergeRequestSchema,
    conflicts: z.array(mergeConflictSchema),
  })
  .strict();

export const mergeRequestListResponseSchema = z.array(mergeRequestSchema);
export const resolveMergeConflictResponseSchema = mergeRequestSchema;

export const finalizeMergeRequestResponseSchema = z.discriminatedUnion("outcome", [
  z.object({ outcome: z.literal("committed"), commit: contextCommitSchema }).strict(),
  z.object({ outcome: z.literal("no_changes"), commit: z.null() }).strict(),
]);

export type MergeRequestPathParams = z.infer<typeof mergeRequestPathParamsSchema>;
export type MergeConflictPathParams = z.infer<typeof mergeConflictPathParamsSchema>;
export type CreateMergeRequestBody = z.infer<typeof createMergeRequestBodySchema>;
export type EditableContextItemProposal = z.infer<typeof editableContextItemProposalSchema>;
export type ResolveMergeConflictBody = z.infer<typeof resolveMergeConflictBodySchema>;
export type FinalizeMergeRequestBody = z.infer<typeof finalizeMergeRequestBodySchema>;
export type FinalizeMergeRequestHeaders = z.infer<typeof finalizeMergeRequestHeadersSchema>;
