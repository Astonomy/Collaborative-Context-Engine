import { z } from "zod";

import { actorSchema } from "./actor";
import {
  contextScopeIdentity,
  contextItemProposalSchema,
  provenanceSchema,
  type Provenance,
} from "./context-item";
import { dateTimeSchema } from "./datetime";
import {
  branchIdSchema,
  contextCommitIdSchema,
  contextDeltaIdSchema,
  contextItemVersionIdSchema,
  conversationIdSchema,
  deltaChangeIdSchema,
  logicalContextItemIdSchema,
  modelRunIdSchema,
  projectIdSchema,
} from "./ids";

const deltaChangeBaseSchema = z.object({
  id: deltaChangeIdSchema,
});

const addContextChangeSchema = deltaChangeBaseSchema
  .extend({
    operation: z.literal("add"),
    proposal: contextItemProposalSchema,
  })
  .strict();

const updateContextChangeSchema = deltaChangeBaseSchema
  .extend({
    operation: z.literal("update"),
    targetLogicalItemId: logicalContextItemIdSchema,
    expectedBaseVersionId: contextItemVersionIdSchema,
    proposal: contextItemProposalSchema,
  })
  .strict();

const supersedeContextChangeSchema = deltaChangeBaseSchema
  .extend({
    operation: z.literal("supersede"),
    targetLogicalItemId: logicalContextItemIdSchema,
    expectedBaseVersionId: contextItemVersionIdSchema,
    proposal: contextItemProposalSchema,
  })
  .strict()
  .superRefine((change, context) => {
    if (change.proposal.explicitSupersedesVersionId !== change.expectedBaseVersionId) {
      context.addIssue({
        code: "custom",
        message: "Supersession must explicitly name the expected base version.",
        path: ["proposal", "explicitSupersedesVersionId"],
      });
    }
  });

const deprecateContextChangeSchema = deltaChangeBaseSchema
  .extend({
    operation: z.literal("deprecate"),
    targetLogicalItemId: logicalContextItemIdSchema,
    expectedBaseVersionId: contextItemVersionIdSchema,
    provenance: z.array(provenanceSchema).min(1),
  })
  .strict();

export const contextDeltaChangeSchema = z.discriminatedUnion("operation", [
  addContextChangeSchema,
  updateContextChangeSchema,
  supersedeContextChangeSchema,
  deprecateContextChangeSchema,
]);

export type ContextDeltaChange = z.infer<typeof contextDeltaChangeSchema>;

export const contextDeltaSchema = z
  .object({
    id: contextDeltaIdSchema,
    projectId: projectIdSchema,
    branchId: branchIdSchema,
    conversationId: conversationIdSchema,
    baseCommitId: contextCommitIdSchema,
    throughMessageSequence: z.int().nonnegative().max(2_147_483_647),
    schemaVersion: z.literal(1),
    extractorRunId: modelRunIdSchema.nullable(),
    revisionOf: contextDeltaIdSchema.nullable(),
    contentHash: z.string().regex(/^[a-f0-9]{64}$/),
    proposedBy: actorSchema,
    createdAt: dateTimeSchema,
    changes: z.array(contextDeltaChangeSchema).max(500),
  })
  .strict()
  .superRefine((delta, context) => {
    const changeIds = delta.changes.map((change) => change.id);
    if (new Set(changeIds).size !== changeIds.length) {
      context.addIssue({ code: "custom", message: "Delta change IDs must be unique." });
    }

    const targetedLineages = new Set<string>();
    const authoritativeSlots = new Set<string>();
    for (const [changeIndex, change] of delta.changes.entries()) {
      if (change.operation !== "add") {
        if (targetedLineages.has(change.targetLogicalItemId)) {
          context.addIssue({
            code: "custom",
            message: "A Delta may change a logical ContextItem lineage only once.",
            path: ["changes", changeIndex, "targetLogicalItemId"],
          });
        }
        targetedLineages.add(change.targetLogicalItemId);
      }
      if (change.operation !== "deprecate" && change.proposal.authority === "authoritative") {
        const slot = `${change.proposal.kind}:${change.proposal.key}:${contextScopeIdentity(change.proposal.scope)}`;
        if (authoritativeSlots.has(slot)) {
          context.addIssue({
            code: "custom",
            message: "A Delta may propose only one authoritative value for a Context slot.",
            path: ["changes", changeIndex, "proposal"],
          });
        }
        authoritativeSlots.add(slot);
      }
    }

    for (const [changeIndex, change] of delta.changes.entries()) {
      const provenance: readonly Provenance[] =
        change.operation === "deprecate" ? change.provenance : change.proposal.provenance;
      for (const [provenanceIndex, source] of provenance.entries()) {
        if (source.projectId !== delta.projectId) {
          context.addIssue({
            code: "custom",
            message: "Delta provenance must belong to the Delta project.",
            path: ["changes", changeIndex, "provenance", provenanceIndex, "projectId"],
          });
        }
        if (source.conversationId !== delta.conversationId) {
          context.addIssue({
            code: "custom",
            message: "Delta provenance must belong to the Delta conversation.",
            path: ["changes", changeIndex, "provenance", provenanceIndex, "conversationId"],
          });
        }
      }
    }
  });

export type ContextDelta = z.infer<typeof contextDeltaSchema>;
