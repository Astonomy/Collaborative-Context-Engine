import { expect, it } from "vitest";
import { attachmentResponseSchema, toAttachmentResponse } from "./attachment-contracts";

it("omits internal storage and rejects signed URLs in public metadata", () => {
  const id = "10000000-0000-4000-8000-000000000001";
  const response = toAttachmentResponse({
    id,
    projectId: id,
    conversationId: id,
    messageId: id,
    ordinal: 0,
    originalFilename: "file",
    mediaKind: "binary",
    declaredMimeType: "application/octet-stream",
    detectedMimeType: "application/octet-stream",
    byteSize: 0,
    checksum: { algorithm: "sha256", value: "a".repeat(64) },
    storage: { provider: "local", key: "private/object", version: "1" },
    createdAt: "2026-09-26T00:00:00.000Z",
    createdBy: { type: "human", userId: id },
  });
  expect(response).not.toHaveProperty("storage");
  expect(
    attachmentResponseSchema.safeParse({ ...response, signedUrl: "https://example.test" }).success,
  ).toBe(false);
});
