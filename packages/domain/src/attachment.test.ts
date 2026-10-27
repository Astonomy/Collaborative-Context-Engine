import { describe, expect, it } from "vitest";
import { attachmentSchema, attachmentEventSchema } from "./attachment";

const id = "10000000-0000-4000-8000-000000000001";
const source = {
  id,
  projectId: id,
  conversationId: id,
  messageId: id,
  ordinal: 0,
  originalFilename: "part.glb",
  mediaKind: "model",
  declaredMimeType: "model/gltf-binary",
  detectedMimeType: "application/octet-stream",
  byteSize: 42,
  checksum: { algorithm: "sha256", value: "a".repeat(64) },
  storage: { provider: "local", key: "objects/part", version: "1" },
  createdAt: "2026-09-26T00:00:00.000Z",
  createdBy: { type: "human", userId: id },
};

describe("attachment evidence", () => {
  it.each(["image", "video", "model", "binary"])(
    "accepts %s without inferring executable behavior",
    (mediaKind) => {
      expect(attachmentSchema.parse({ ...source, mediaKind }).mediaKind).toBe(mediaKind);
    },
  );
  it.each([
    { byteSize: -1 },
    { byteSize: 0.5 },
    { byteSize: Number.MAX_SAFE_INTEGER + 1 },
    { metadata: { width: -1 } },
    { metadata: { script: "execute" } },
    { metadata: { format: "x".repeat(101) } },
    { declaredMimeType: "image/png; script=1" },
    { checksum: { algorithm: "md5", value: "a".repeat(64) } },
    { checksum: { algorithm: "sha256", value: "A".repeat(64) } },
    { storage: { provider: "local", key: "https://signed.example/a?token=secret", version: "1" } },
    { createdBy: { type: "human" } },
    { messageId: null },
  ])("rejects invalid evidence %j", (invalid) => {
    expect(attachmentSchema.safeParse({ ...source, ...invalid }).success).toBe(false);
  });
  it("accepts bounded metadata and records lifecycle provenance independently", () => {
    const parsed = attachmentSchema.parse({
      ...source,
      metadata: { width: 640, height: 480, durationMilliseconds: 0, format: "glb" },
    });
    expect(parsed.metadata?.width).toBe(640);
    expect(
      attachmentEventSchema.parse({
        id,
        projectId: id,
        attachmentId: id,
        sequence: 1,
        processingStatus: "pending",
        availability: "quarantined",
        reason: "Awaiting inspection",
        occurredAt: source.createdAt,
        actor: source.createdBy,
      }).availability,
    ).toBe("quarantined");
    expect(parsed).not.toHaveProperty("processingStatus");
  });
});
