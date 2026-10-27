import { attachmentSchema, userIdSchema } from "@cce/domain";
import { z } from "zod";
export const importAttachmentSchema = attachmentSchema
  .omit({
    conversationId: true,
    messageId: true,
    ordinal: true,
    createdBy: true,
  })
  .extend({ actorUserId: userIdSchema, uploadId: z.uuid(), expiresAt: z.string().datetime() })
  .strict();
export type ImportAttachment = z.infer<typeof importAttachmentSchema>;
