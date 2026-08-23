import {
  contextCommitIdSchema,
  contextItemKindSchema,
  contextItemLifecycleSchema,
  contextItemVersionSchema,
} from "@cce/domain";
import { z } from "zod";

export const getContextQuerySchema = z
  .object({
    kind: contextItemKindSchema.optional(),
    lifecycle: contextItemLifecycleSchema.optional(),
  })
  .strict();

export const contextSnapshotResponseSchema = z
  .object({
    commitId: contextCommitIdSchema,
    items: z.array(contextItemVersionSchema),
  })
  .strict();

export const contextItemListResponseSchema = z.array(contextItemVersionSchema);

export type GetContextQuery = z.infer<typeof getContextQuerySchema>;
export type ContextSnapshotResponse = z.infer<typeof contextSnapshotResponseSchema>;
