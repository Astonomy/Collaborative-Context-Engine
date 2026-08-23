import { contextValueSchema } from "@cce/shared";
import { z } from "zod";

import { actorSchema, type Actor } from "./actor";
import { dateTimeSchema } from "./datetime";
import { DomainError } from "./errors";
import {
  contextCommitIdSchema,
  contextItemVersionIdSchema,
  conversationIdSchema,
  logicalContextItemIdSchema,
  messageIdSchema,
  modelRunIdSchema,
  projectIdSchema,
} from "./ids";

export const contextItemKindSchema = z.enum([
  "fact",
  "decision",
  "requirement",
  "assumption",
  "constraint",
  "task",
  "question",
  "risk",
  "artifact",
  "preference",
  "rejected_option",
  "architecture",
]);

export const contextItemLifecycleSchema = z.enum(["active", "deprecated", "superseded"]);
export const contextItemAuthoritySchema = z.enum(["authoritative", "alternative"]);

export const contextScopeSchema = z
  .object({
    component: z.string().trim().min(1).max(160).optional(),
    environment: z.string().trim().min(1).max(80).optional(),
    audience: z.string().trim().min(1).max(120).optional(),
    effectiveFrom: dateTimeSchema.optional(),
    effectiveTo: dateTimeSchema.optional(),
    tags: z.array(z.string().trim().min(1).max(80)).max(30).default([]),
  })
  .strict()
  .superRefine((scope, context) => {
    if (
      scope.effectiveFrom !== undefined &&
      scope.effectiveTo !== undefined &&
      Date.parse(scope.effectiveFrom) >= Date.parse(scope.effectiveTo)
    ) {
      context.addIssue({
        code: "custom",
        message: "effectiveFrom must be earlier than effectiveTo.",
        path: ["effectiveTo"],
      });
    }
  });

export type ContextScope = z.infer<typeof contextScopeSchema>;

export function contextScopeIdentity(scope: ContextScope): string {
  return JSON.stringify({
    audience: scope.audience ?? null,
    component: scope.component ?? null,
    effectiveFrom:
      scope.effectiveFrom === undefined ? null : new Date(scope.effectiveFrom).toISOString(),
    effectiveTo:
      scope.effectiveTo === undefined ? null : new Date(scope.effectiveTo).toISOString(),
    environment: scope.environment ?? null,
    tags: [...scope.tags].sort(),
  });
}

export const provenanceSchema = z
  .object({
    projectId: projectIdSchema,
    conversationId: conversationIdSchema,
    messageIds: z.array(messageIdSchema).min(1).max(100),
    actor: actorSchema,
    modelRunId: modelRunIdSchema.nullable(),
    recordedAt: dateTimeSchema,
  })
  .strict()
  .superRefine((provenance, context) => {
    if (new Set(provenance.messageIds).size !== provenance.messageIds.length) {
      context.addIssue({ code: "custom", message: "Provenance message IDs must be unique." });
    }
  });

export type Provenance = z.infer<typeof provenanceSchema>;

const normalizedContextKeySchema = z
  .string()
  .trim()
  .min(1)
  .max(240)
  .regex(
    /^[a-z0-9]+(?:[._-][a-z0-9]+)*$/,
    "Context keys must be normalized lowercase segments.",
  );

export const contextItemProposalSchema = z
  .object({
    kind: contextItemKindSchema,
    key: normalizedContextKeySchema,
    value: contextValueSchema,
    scope: contextScopeSchema,
    authority: contextItemAuthoritySchema.default("authoritative"),
    confidence: z.number().min(0).max(1),
    provenance: z.array(provenanceSchema).min(1).max(20),
    explicitSupersedesVersionId: contextItemVersionIdSchema.nullable().default(null),
  })
  .strict();

export type ContextItemProposal = z.infer<typeof contextItemProposalSchema>;
export type ContextItemKind = z.infer<typeof contextItemKindSchema>;

export const contextItemVersionSchema = contextItemProposalSchema
  .omit({ explicitSupersedesVersionId: true })
  .extend({
    id: contextItemVersionIdSchema,
    logicalItemId: logicalContextItemIdSchema,
    projectId: projectIdSchema,
    commitId: contextCommitIdSchema,
    previousVersionId: contextItemVersionIdSchema.nullable(),
    lifecycle: contextItemLifecycleSchema,
    scopeHash: z.string().regex(/^[a-f0-9]{64}$/),
    supersedesVersionId: contextItemVersionIdSchema.nullable(),
    createdAt: dateTimeSchema,
  })
  .strict()
  .superRefine((item, context) => {
    for (const [index, provenance] of item.provenance.entries()) {
      if (provenance.projectId !== item.projectId) {
        context.addIssue({
          code: "custom",
          message: "ContextItem provenance must belong to the same project.",
          path: ["provenance", index, "projectId"],
        });
      }
    }
    if (item.lifecycle === "superseded" && item.supersedesVersionId === null) {
      context.addIssue({
        code: "custom",
        message: "A superseded version must name the version relationship.",
        path: ["supersedesVersionId"],
      });
    }
  });

export type ContextItemVersion = z.infer<typeof contextItemVersionSchema>;

const highRiskKinds: ReadonlySet<ContextItemKind> = new Set([
  "decision",
  "requirement",
  "constraint",
  "architecture",
]);

export function isHighRiskContextKind(kind: ContextItemKind): boolean {
  return highRiskKinds.has(kind);
}

export function assertHighRiskApproval(kind: ContextItemKind, committer: Actor): void {
  if (isHighRiskContextKind(kind) && committer.type !== "human") {
    throw new DomainError(
      "HIGH_RISK_APPROVAL_REQUIRED",
      `${kind} context requires an authorized human committer.`,
    );
  }
}

export function assertSameProjectProvenance(
  projectId: Provenance["projectId"],
  provenance: readonly Provenance[],
): void {
  if (provenance.length === 0) {
    throw new DomainError("PROVENANCE_REQUIRED", "At least one provenance record is required.");
  }
  if (provenance.some((entry) => entry.projectId !== projectId)) {
    throw new DomainError(
      "PROJECT_SCOPE_MISMATCH",
      "Every provenance record must belong to the same project as the context item.",
    );
  }
}
