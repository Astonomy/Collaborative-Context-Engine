import { z } from "zod";
import { actorSchema } from "./actor";
import { dateTimeSchema } from "./datetime";
import { conversationIdSchema, messageIdSchema, projectIdSchema } from "./ids";

export const attachmentIdSchema = z.uuid().brand<"AttachmentId">();
export const attachmentEventIdSchema = z.uuid().brand<"AttachmentEventId">();
export const attachmentMediaKindSchema = z.enum(["image", "video", "model", "binary"]);
export const attachmentProcessingStatusSchema = z.enum([
  "pending",
  "processing",
  "succeeded",
  "failed",
]);
export const attachmentMetadataSchema = z
  .object({
    width: z.int().positive().max(1_000_000).optional(),
    height: z.int().positive().max(1_000_000).optional(),
    durationMilliseconds: z.int().nonnegative().optional(),
    format: z.string().min(1).max(100).optional(),
  })
  .strict();
export const attachmentMimeTypeSchema = z
  .string()
  .max(255)
  .regex(/^[a-z0-9!#$&^_.+-]+\/[a-z0-9!#$&^_.+-]+$/);
export const attachmentSchema = z
  .object({
    id: attachmentIdSchema,
    projectId: projectIdSchema,
    conversationId: conversationIdSchema,
    messageId: messageIdSchema,
    ordinal: z.int().nonnegative().max(1023),
    originalFilename: z.string().min(1).max(255),
    mediaKind: attachmentMediaKindSchema,
    declaredMimeType: attachmentMimeTypeSchema,
    detectedMimeType: attachmentMimeTypeSchema,
    byteSize: z.int().nonnegative(),
    checksum: z
      .object({ algorithm: z.literal("sha256"), value: z.string().regex(/^[a-f0-9]{64}$/) })
      .strict(),
    storage: z
      .object({
        provider: z.string().regex(/^[a-z0-9-]{1,64}$/),
        key: z
          .string()
          .min(1)
          .max(1024)
          .regex(/^[a-zA-Z0-9/_-]+$/),
        version: z.string().min(1).max(255),
      })
      .strict(),
    createdAt: dateTimeSchema,
    createdBy: actorSchema,
    metadata: attachmentMetadataSchema.optional(),
  })
  .strict();

// Lifecycle records are appended; neither source bytes nor their binding can change.
export const attachmentEventSchema = z
  .object({
    id: attachmentEventIdSchema,
    projectId: projectIdSchema,
    attachmentId: attachmentIdSchema,
    sequence: z.int().positive().max(2_147_483_647),
    processingStatus: attachmentProcessingStatusSchema,
    availability: z.enum(["available", "quarantined", "unavailable", "deprecated"]),
    reason: z.string().trim().min(1).max(1000),
    occurredAt: dateTimeSchema,
    actor: actorSchema,
  })
  .strict();
export type Attachment = z.infer<typeof attachmentSchema>;
export type AttachmentId = z.infer<typeof attachmentIdSchema>;
export type AttachmentEvent = z.infer<typeof attachmentEventSchema>;
