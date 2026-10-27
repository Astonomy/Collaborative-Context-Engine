import { afterEach, describe, expect, it, vi } from "vitest";
import { attachmentSchema } from "@cce/domain";
import {
  ApplicationError,
  MediaProcessingService,
  type AttachmentService,
  type MediaInspector,
} from "@cce/application";
import { HeaderMediaInspector } from "@cce/storage/media-server";
import { uuid } from "./fixtures";

const attachment = attachmentSchema.parse({
  id: uuid(101),
  projectId: uuid(102),
  conversationId: uuid(103),
  messageId: uuid(104),
  ordinal: 0,
  originalFilename: "file.bin",
  mediaKind: "binary",
  declaredMimeType: "application/octet-stream",
  detectedMimeType: "application/octet-stream",
  byteSize: 4,
  checksum: { algorithm: "sha256", value: "a".repeat(64) },
  storage: { provider: "local", key: "private", version: "1" },
  createdAt: "2026-09-26T00:00:00.000Z",
  createdBy: { type: "human", userId: uuid(105) },
});
const input = {
  projectId: attachment.projectId,
  attachmentId: attachment.id,
  actorUserId:
    attachment.createdBy.type === "human"
      ? attachment.createdBy.userId
      : (() => {
          throw new Error();
        })(),
};
async function* source(value = new Uint8Array(4)) {
  yield value;
}
function setup(inspector: MediaInspector = new HeaderMediaInspector()) {
  const get = vi.fn<AttachmentService["get"]>().mockResolvedValue(attachment);
  const download = vi
    .fn<AttachmentService["download"]>()
    .mockImplementation(async () => ({ attachment, bytes: source(), range: undefined }));
  return { get, download, service: new MediaProcessingService({ get, download }, inspector) };
}
afterEach(() => vi.useRealTimers());
describe("MediaProcessingService", () => {
  it("returns only safe derived information and requests a bounded range", async () => {
    const f = setup();
    const original = structuredClone(attachment);
    const result = await f.service.inspect(input);
    expect(result).toMatchObject({
      status: "succeeded",
      filename: "file.bin",
      byteSize: 4,
      description: { preview: "download" },
    });
    expect(result).not.toHaveProperty("storage");
    expect(f.download).toHaveBeenCalledWith({ ...input, range: "bytes=0-3" });
    expect(attachment).toEqual(original);
    f.get.mockResolvedValue({ ...attachment, byteSize: 100_000 });
    await f.service.inspect(input);
    expect(f.download).toHaveBeenLastCalledWith({ ...input, range: "bytes=0-65535" });
  });
  it("authorizes before opening and preserves revocation errors", async () => {
    const f = setup();
    f.get.mockRejectedValueOnce(new ApplicationError("NOT_FOUND", "Not found."));
    await expect(f.service.inspect(input)).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(f.download).not.toHaveBeenCalled();
    f.download.mockRejectedValueOnce(new ApplicationError("FORBIDDEN", "Revoked."));
    await expect(f.service.inspect(input)).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
  it("sanitizes storage/parser failures and invalid adapter output", async () => {
    const f = setup({
      inspect: () => {
        throw new Error("secret C:/storage");
      },
    });
    expect(await f.service.inspect(input)).toMatchObject({
      status: "failed",
      error: "inspection-failed",
      description: { preview: "download" },
    });
    f.download.mockRejectedValueOnce(new Error("secret"));
    expect(JSON.stringify(await f.service.inspect(input))).not.toContain("secret");
    const invalid = setup({
      inspect: () => ({
        mimeType: "invalid",
        mimeValidation: "unknown",
        metadata: {},
        preview: "download",
        thumbnail: "unavailable",
        poster: "unavailable",
      }),
    });
    expect((await invalid.service.inspect(input)).status).toBe("failed");
  });
  it.each([0, 3, 5])("fails safely on empty/truncated/oversized streams (%i)", async (length) => {
    const f = setup();
    f.download.mockResolvedValue({
      attachment,
      bytes: source(new Uint8Array(length)),
      range: undefined,
    });
    expect((await f.service.inspect(input)).status).toBe("failed");
    f.get.mockResolvedValue({ ...attachment, byteSize: 0 });
    expect((await f.service.inspect(input)).status).toBe("failed");
  });
  it("bounds repeated empty chunks and closes the iterator", async () => {
    const f = setup();
    let closed = false;
    async function* empty() {
      try {
        while (true) yield new Uint8Array();
      } finally {
        closed = true;
      }
    }
    f.download.mockResolvedValue({ attachment, bytes: empty(), range: undefined });
    expect((await f.service.inspect(input)).status).toBe("failed");
    expect(closed).toBe(true);
  });
  it("times out, keeps outstanding work bounded and frees slots when I/O finishes", async () => {
    vi.useFakeTimers();
    const f = setup();
    let finish: ((value: Awaited<ReturnType<AttachmentService["download"]>>) => void) | undefined;
    const blocked = new Promise<Awaited<ReturnType<AttachmentService["download"]>>>((resolve) => {
      finish = resolve;
    });
    f.download.mockReturnValue(blocked);
    const requests = Array.from({ length: 4 }, () => f.service.inspect(input));
    await vi.advanceTimersByTimeAsync(2000);
    expect(await Promise.all(requests)).toEqual(
      expect.arrayContaining([expect.objectContaining({ error: "timeout" })]),
    );
    expect((await f.service.inspect(input)).error).toBe("busy");
    finish?.({ attachment, bytes: source(), range: undefined });
    await vi.advanceTimersByTimeAsync(0);
    f.download.mockImplementation(async () => ({ attachment, bytes: source(), range: undefined }));
    expect((await f.service.inspect(input)).status).toBe("succeeded");
  });
});
