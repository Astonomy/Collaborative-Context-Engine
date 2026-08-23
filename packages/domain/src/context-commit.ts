import { z } from "zod";

import { actorSchema } from "./actor";
import { contextItemVersionSchema, contextScopeIdentity } from "./context-item";
import { dateTimeSchema } from "./datetime";
import {
  commitChangeIdSchema,
  contextCommitIdSchema,
  contextDeltaIdSchema,
  deltaChangeIdSchema,
  logicalContextItemIdSchema,
  projectIdSchema,
} from "./ids";

export const contextCommitOperationSchema = z.enum(["add", "update", "supersede", "deprecate"]);

export const contextCommitChangeSchema = z
  .object({
    id: commitChangeIdSchema,
    ordinal: z.int().nonnegative(),
    operation: contextCommitOperationSchema,
    logicalItemId: logicalContextItemIdSchema,
    beforeVersion: contextItemVersionSchema.nullable(),
    afterVersion: contextItemVersionSchema,
    sourceDeltaId: contextDeltaIdSchema,
    sourceDeltaChangeId: deltaChangeIdSchema,
  })
  .strict()
  .superRefine((change, context) => {
    if (change.afterVersion.logicalItemId !== change.logicalItemId) {
      context.addIssue({ code: "custom", message: "Commit change lineage IDs must match." });
    }
    if (change.operation === "add" && change.beforeVersion !== null) {
      context.addIssue({ code: "custom", message: "An add change cannot have a before version." });
    }
    if (change.operation !== "add" && change.beforeVersion === null) {
      context.addIssue({ code: "custom", message: "A non-add change requires a before version." });
    }
    if (change.beforeVersion?.logicalItemId !== undefined) {
      if (change.beforeVersion.logicalItemId !== change.logicalItemId) {
        context.addIssue({ code: "custom", message: "Before version lineage must match." });
      }
      if (change.afterVersion.previousVersionId !== change.beforeVersion.id) {
        context.addIssue({
          code: "custom",
          message: "After version must link to the before version.",
        });
      }
    }
    if (change.operation === "deprecate" && change.afterVersion.lifecycle !== "deprecated") {
      context.addIssue({
        code: "custom",
        message: "A deprecate change must create a deprecated version.",
      });
    }
    if (change.operation === "supersede") {
      if (
        change.beforeVersion === null ||
        change.afterVersion.supersedesVersionId !== change.beforeVersion.id
      ) {
        context.addIssue({
          code: "custom",
          message: "A supersede change must explicitly link the replaced version.",
        });
      }
    }
  });

export type ContextCommitChange = z.infer<typeof contextCommitChangeSchema>;

export const contextCommitSchema = z
  .object({
    id: contextCommitIdSchema,
    projectId: projectIdSchema,
    kind: z.enum(["genesis", "semantic"]),
    parentCommitId: contextCommitIdSchema.nullable(),
    version: z.int().nonnegative(),
    idempotencyKey: z.string().trim().min(1).max(200),
    summary: z.string().trim().min(1).max(500),
    sourceDeltaIds: z.array(contextDeltaIdSchema),
    proposedBy: z.array(actorSchema),
    committedBy: actorSchema,
    changes: z.array(contextCommitChangeSchema),
    createdAt: dateTimeSchema,
  })
  .strict()
  .superRefine((commit, context) => {
    if (commit.kind === "genesis") {
      if (commit.parentCommitId !== null || commit.version !== 0 || commit.changes.length !== 0) {
        context.addIssue({
          code: "custom",
          message: "A genesis commit has version zero, no parent, and no semantic changes.",
        });
      }
    } else if (
      commit.parentCommitId === null ||
      commit.version === 0 ||
      commit.changes.length === 0 ||
      commit.sourceDeltaIds.length === 0
    ) {
      context.addIssue({
        code: "custom",
        message:
          "A semantic commit requires a parent, positive version, source Delta, and changes.",
      });
    }

    const ordinals = commit.changes.map((change) => change.ordinal);
    const expected = commit.changes.map((_, index) => index);
    if (ordinals.some((ordinal, index) => ordinal !== expected[index])) {
      context.addIssue({
        code: "custom",
        message: "Commit changes must have contiguous ordinals.",
      });
    }

    const changedLineages = new Set<string>();
    const authoritativeSlots = new Set<string>();
    for (const [index, change] of commit.changes.entries()) {
      if (changedLineages.has(change.logicalItemId)) {
        context.addIssue({
          code: "custom",
          message: "A Commit may create only one version per logical ContextItem lineage.",
          path: ["changes", index, "logicalItemId"],
        });
      }
      changedLineages.add(change.logicalItemId);
      if (
        change.afterVersion.authority === "authoritative" &&
        change.afterVersion.lifecycle === "active"
      ) {
        const slot = `${change.afterVersion.kind}:${change.afterVersion.key}:${contextScopeIdentity(change.afterVersion.scope)}`;
        if (authoritativeSlots.has(slot)) {
          context.addIssue({
            code: "custom",
            message: "A Commit may write only one authoritative value per Context slot.",
            path: ["changes", index, "afterVersion"],
          });
        }
        authoritativeSlots.add(slot);
      }
    }

    for (const [index, change] of commit.changes.entries()) {
      if (
        change.afterVersion.projectId !== commit.projectId ||
        change.afterVersion.commitId !== commit.id ||
        (change.beforeVersion !== null && change.beforeVersion.projectId !== commit.projectId)
      ) {
        context.addIssue({
          code: "custom",
          message: "Commit changes and versions must remain inside the Commit project.",
          path: ["changes", index],
        });
      }
    }
  });

export type ContextCommit = z.infer<typeof contextCommitSchema>;
