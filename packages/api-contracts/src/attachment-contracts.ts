import {
  attachmentIdSchema,
  attachmentSchema,
  attachmentEventSchema,
  projectIdSchema,
} from "@cce/domain";
import { z } from "zod";

export const attachmentPathParamsSchema = z
  .object({
    projectId: projectIdSchema,
    attachmentId: attachmentIdSchema,
  })
  .strict();
// Storage locators are internal. No signed URL is part of persisted metadata.
export const attachmentResponseSchema = attachmentSchema.omit({ storage: true });
export const attachmentListResponseSchema = z.array(attachmentResponseSchema);
export const attachmentEventResponseSchema = attachmentEventSchema;
export type AttachmentResponse = z.infer<typeof attachmentResponseSchema>;
export function toAttachmentResponse(value: unknown): AttachmentResponse {
  const parsed = attachmentSchema.parse(value);
  return attachmentResponseSchema.strip().parse(parsed);
}
