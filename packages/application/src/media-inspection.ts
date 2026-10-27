import { attachmentMetadataSchema, attachmentMimeTypeSchema } from "@cce/domain";
import { z } from "zod";

/** Browser-safe result contract. Capabilities never authorize execution or resource fetching. */
export const mediaDescriptionSchema = z
  .object({
    mimeType: attachmentMimeTypeSchema,
    mimeValidation: z.enum(["header", "unknown"]),
    metadata: attachmentMetadataSchema,
    preview: z.enum(["image-original", "video-stream", "3d-isolated", "download"]),
    thumbnail: z.literal("unavailable"),
    poster: z.enum(["client-frame", "unavailable"]),
  })
  .strict();
export const mediaInspectionSchema = z
  .object({
    status: z.enum(["succeeded", "failed"]),
    error: z.enum(["inspection-failed", "timeout", "busy"]).nullable(),
    filename: z.string().min(1).max(255),
    byteSize: z.int().nonnegative(),
    downloadable: z.literal(true),
    description: mediaDescriptionSchema,
  })
  .strict();
export type MediaDescription = z.infer<typeof mediaDescriptionSchema>;
export type MediaInspection = z.infer<typeof mediaInspectionSchema>;
export interface MediaInspector {
  /** Synchronous, bounded header inspection; never decode pixels, execute models or fetch URIs. */
  inspect(prefix: Uint8Array, source: { filename: string; byteSize: number }): MediaDescription;
}
export const mediaPrefixBytes = 64 * 1024;
