import { attachmentResponseSchema, type AttachmentResponse } from "@cce/api-contracts";
import { inspectionSchema, type Inspection } from "./presentation";

export function attachmentFixture(overrides: Partial<AttachmentResponse> = {}): AttachmentResponse {
  return attachmentResponseSchema.parse({
    id: "00000000-0000-4000-8000-000000000007",
    projectId: "00000000-0000-4000-8000-000000000001",
    conversationId: "00000000-0000-4000-8000-000000000002",
    messageId: "00000000-0000-4000-8000-000000000003",
    ordinal: 0,
    originalFilename: "sample.png",
    mediaKind: "image",
    declaredMimeType: "image/png",
    detectedMimeType: "image/png",
    byteSize: 68,
    checksum: { algorithm: "sha256", value: "a".repeat(64) },
    createdAt: "2026-09-30T00:00:00.000Z",
    createdBy: { type: "human", userId: "00000000-0000-4000-8000-000000000004" },
    ...overrides,
  });
}
export function inspectionFixture(
  preview: Inspection["description"]["preview"] = "image-original",
  byteSize = 68,
): Inspection {
  return inspectionSchema.parse({
    status: "succeeded",
    error: null,
    filename: "sample",
    byteSize,
    downloadable: true,
    description: {
      mimeType:
        preview === "image-original"
          ? "image/png"
          : preview === "video-stream"
            ? "video/mp4"
            : preview === "3d-isolated"
              ? "model/gltf-binary"
              : "application/octet-stream",
      mimeValidation: preview === "download" ? "unknown" : "header",
      metadata: preview === "image-original" ? { width: 1, height: 1 } : {},
      preview,
      thumbnail: "unavailable",
      poster: preview === "video-stream" ? "client-frame" : "unavailable",
    },
  });
}
export const pngFixture = Uint8Array.from(
  atob(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=",
  ),
  (c) => c.charCodeAt(0),
);
export function gltfFixture(): Record<string, unknown> {
  const data = new Float32Array([-1, -1, 0, 1, -1, 0, 0, 1, 0]);
  return {
    asset: { version: "2.0" },
    buffers: [
      {
        byteLength: 36,
        uri:
          "data:application/octet-stream;base64," +
          btoa(String.fromCharCode(...new Uint8Array(data.buffer))),
      },
    ],
    bufferViews: [{ buffer: 0, byteLength: 36 }],
    accessors: [{ bufferView: 0, componentType: 5126, count: 3, type: "VEC3" }],
    meshes: [{ primitives: [{ attributes: { POSITION: 0 } }] }],
    nodes: [{ mesh: 0 }],
    scenes: [{ nodes: [0] }],
    scene: 0,
  };
}
export function glbFixture(): ArrayBuffer {
  const model = { ...gltfFixture(), buffers: [{ byteLength: 36 }] };
  const json = JSON.stringify(model);
  const padded = new TextEncoder().encode(json.padEnd(Math.ceil(json.length / 4) * 4, " "));
  const bytes = new ArrayBuffer(20 + padded.length + 8 + 36);
  const view = new DataView(bytes);
  view.setUint32(0, 0x46546c67, true);
  view.setUint32(4, 2, true);
  view.setUint32(8, bytes.byteLength, true);
  view.setUint32(12, padded.length, true);
  view.setUint32(16, 0x4e4f534a, true);
  new Uint8Array(bytes, 20, padded.length).set(padded);
  view.setUint32(20 + padded.length, 36, true);
  view.setUint32(24 + padded.length, 0x004e4942, true);
  new Uint8Array(bytes, 28 + padded.length).set(
    new Uint8Array(new Float32Array([-1, -1, 0, 1, -1, 0, 0, 1, 0]).buffer),
  );
  return bytes;
}
