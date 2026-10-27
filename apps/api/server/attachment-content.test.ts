import { describe, expect, it } from "vitest";
import { attachmentSchema } from "@cce/domain";
import { attachmentContentResponse } from "./attachment-content";

describe("standalone attachment content", () => {
  it.each(["image/png", "image/jpeg", "video/mp4", "application/octet-stream"])(
    "streams %s with server-owned MIME and range headers",
    async (mime) => {
      const id = "00000000-0000-4000-8000-000000000001";
      const attachment = attachmentSchema.parse({
        id,
        projectId: id,
        conversationId: id,
        messageId: id,
        ordinal: 0,
        originalFilename: "evidence.bin",
        declaredMimeType: mime,
        detectedMimeType: mime,
        mediaKind: mime.startsWith("image/")
          ? "image"
          : mime.startsWith("video/")
            ? "video"
            : "binary",
        byteSize: 8,
        checksum: { algorithm: "sha256", value: "a".repeat(64) },
        storage: { provider: "local", key: id, version: "1" },
        createdAt: "2026-10-08T00:00:00.000Z",
        createdBy: { type: "human", userId: id },
      });
      for (const range of [undefined, { start: 2, end: 3 }]) {
        const response = attachmentContentResponse({
          attachment,
          range,
          bytes: (async function* () {
            yield new Uint8Array(range ? [2, 3] : [0, 1, 2, 3, 4, 5, 6, 7]);
          })(),
        });
        expect(response.status).toBe(range ? 206 : 200);
        expect(response.headers.get("content-type")).toBe(mime);
        expect(response.headers.get("accept-ranges")).toBe("bytes");
        expect(response.headers.get("content-length")).toBe(range ? "2" : "8");
        expect(response.headers.get("content-range")).toBe(range ? "bytes 2-3/8" : null);
        expect(response.headers.get("content-disposition")).toMatch(
          mime === "application/octet-stream" ? /^attachment;/ : /^inline;/,
        );
        expect((await response.arrayBuffer()).byteLength).toBe(range ? 2 : 8);
      }
    },
  );
});
