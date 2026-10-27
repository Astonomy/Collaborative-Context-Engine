import { apiUrl } from "../data/api-client";
import { z } from "zod";
import type { AttachmentResponse } from "@cce/api-contracts";

// Browser projection of the fixed S3 inspection response; no application runtime import.
export const inspectionSchema = z
  .object({
    status: z.enum(["succeeded", "failed"]),
    error: z.enum(["inspection-failed", "timeout", "busy"]).nullable(),
    filename: z.string().min(1).max(255),
    byteSize: z.int().nonnegative(),
    downloadable: z.literal(true),
    description: z
      .object({
        mimeType: z.string().max(255),
        mimeValidation: z.enum(["header", "unknown"]),
        metadata: z
          .object({
            width: z.int().positive().max(1_000_000).optional(),
            height: z.int().positive().max(1_000_000).optional(),
            durationMilliseconds: z.int().nonnegative().optional(),
            format: z.string().max(100).optional(),
          })
          .strict(),
        preview: z.enum(["image-original", "video-stream", "3d-isolated", "download"]),
        thumbnail: z.literal("unavailable"),
        poster: z.enum(["client-frame", "unavailable"]),
      })
      .strict(),
  })
  .strict();
export type Inspection = z.infer<typeof inspectionSchema>;
export type RendererKind = "image" | "video" | "model" | "model-file" | "file";
export const thumbnailByteLimit = 256 * 1024;
export const imageByteLimit = 20 * 1024 * 1024;
export const modelByteLimit = 8 * 1024 * 1024;

type Rule = {
  kind: RendererKind;
  matches: (attachment: AttachmentResponse, inspection: Inspection) => boolean;
};
export const attachmentRendererRegistry: readonly Rule[] = [
  {
    kind: "image",
    matches: (a, i) =>
      i.description.preview === "image-original" &&
      ["image/png", "image/jpeg", "image/gif"].includes(i.description.mimeType) &&
      a.byteSize <= imageByteLimit &&
      !!i.description.metadata.width &&
      !!i.description.metadata.height &&
      i.description.metadata.width * i.description.metadata.height <= 40_000_000,
  },
  {
    kind: "video",
    matches: (_a, i) =>
      i.description.preview === "video-stream" && i.description.mimeType === "video/mp4",
  },
  {
    kind: "model",
    matches: (a, i) =>
      i.description.preview === "3d-isolated" &&
      ["model/gltf-binary", "model/gltf+json"].includes(i.description.mimeType) &&
      a.byteSize <= modelByteLimit,
  },
  {
    kind: "model-file",
    matches: (a, i) =>
      a.mediaKind === "model" ||
      i.description.preview === "3d-isolated" ||
      i.description.metadata.format?.startsWith("unverified-") === true,
  },
  { kind: "file", matches: () => true },
];
export function rendererFor(
  attachment: AttachmentResponse,
  inspection: Inspection | null,
): RendererKind {
  if (
    !inspection ||
    inspection.status !== "succeeded" ||
    inspection.byteSize !== attachment.byteSize
  )
    return "file";
  if (inspection.description.mimeValidation !== "header")
    return attachment.mediaKind === "model" ||
      inspection.description.metadata.format?.startsWith("unverified-")
      ? "model-file"
      : "file";
  return (
    attachmentRendererRegistry.find((rule) => rule.matches(attachment, inspection))?.kind ?? "file"
  );
}
export function contentPath(attachment: AttachmentResponse): string {
  return `/api/projects/${encodeURIComponent(attachment.projectId)}/attachments/${encodeURIComponent(attachment.id)}/content`;
}
export function formatBytes(bytes: number): string {
  return bytes < 1024
    ? `${bytes} B`
    : bytes < 1024 * 1024
      ? `${(bytes / 1024).toFixed(1)} KiB`
      : `${(bytes / 1024 / 1024).toFixed(1)} MiB`;
}

export function contentUrl(attachment: AttachmentResponse): string {
  return apiUrl(contentPath(attachment));
}
