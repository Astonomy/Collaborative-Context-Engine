import { randomUUID } from "node:crypto";
import { ApplicationError } from "@cce/application";
import { attachmentSchema, userSchema } from "@cce/domain";
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "../app/api/projects/[projectId]/conversations/[conversationId]/attachments/route";
import { GET } from "../app/api/projects/[projectId]/attachments/[attachmentId]/content/route";
import { GET as metadata } from "../app/api/projects/[projectId]/attachments/[attachmentId]/route";
import { GET as inspection } from "../app/api/projects/[projectId]/attachments/[attachmentId]/inspection/route";

const mocks = vi.hoisted(() => ({
  upload: vi.fn(),
  download: vi.fn(),
  get: vi.fn(),
  inspect: vi.fn(),
  authenticate: vi.fn(),
}));
vi.mock("./runtime", () => ({
  getWebRuntime: () => ({
    attachments: { upload: mocks.upload, download: mocks.download, get: mocks.get },
    media: { inspect: mocks.inspect },
    sessions: { authenticateApiToken: mocks.authenticate },
    sessionCookie: { open: () => "cookie-token" },
  }),
}));
const actor = userSchema.parse({
  id: randomUUID(),
  email: "a@example.test",
  displayName: "A",
  createdAt: new Date().toISOString(),
});
const attachment = attachmentSchema.parse({
  id: randomUUID(),
  projectId: randomUUID(),
  conversationId: randomUUID(),
  messageId: randomUUID(),
  ordinal: 0,
  originalFilename: "clip.mp4",
  mediaKind: "video",
  declaredMimeType: "video/mp4",
  detectedMimeType: "video/mp4",
  byteSize: 8,
  checksum: { algorithm: "sha256", value: "a".repeat(64) },
  storage: { provider: "local", key: randomUUID(), version: "1" },
  createdAt: new Date().toISOString(),
  createdBy: { type: "human", userId: actor.id },
});
const contentContext = {
  params: Promise.resolve({ projectId: attachment.projectId, attachmentId: attachment.id }),
};
const uploadContext = {
  params: Promise.resolve({
    projectId: attachment.projectId,
    conversationId: attachment.conversationId,
  }),
};
beforeEach(() => {
  vi.clearAllMocks();
  mocks.authenticate.mockResolvedValue(actor);
  mocks.upload.mockResolvedValue(attachment);
  mocks.get.mockResolvedValue(attachment);
});

describe("Attachment authenticated HTTP transport", () => {
  it("authenticates inspection and returns validated, noncached derived metadata", async () => {
    expect(
      (await inspection(new NextRequest("http://localhost/inspection"), contentContext)).status,
    ).toBe(401);
    expect(mocks.inspect).not.toHaveBeenCalled();
    mocks.inspect.mockResolvedValue({
      status: "succeeded",
      error: null,
      filename: "clip.mp4",
      byteSize: 8,
      downloadable: true,
      description: {
        mimeType: "video/mp4",
        mimeValidation: "header",
        metadata: { format: "mp4" },
        preview: "video-stream",
        thumbnail: "unavailable",
        poster: "client-frame",
      },
    });
    const response = await inspection(
      new NextRequest("http://localhost/inspection", { headers: { authorization: "Bearer test" } }),
      contentContext,
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(mocks.inspect).toHaveBeenCalledWith({
      projectId: attachment.projectId,
      attachmentId: attachment.id,
      actorUserId: actor.id,
    });
    expect(await response.json()).toMatchObject({ description: { preview: "video-stream" } });
    mocks.inspect.mockRejectedValueOnce(
      new ApplicationError("NOT_FOUND", "Attachment was not found."),
    );
    expect(
      (
        await inspection(
          new NextRequest("http://localhost/inspection", {
            headers: { authorization: "Bearer test" },
          }),
          contentContext,
        )
      ).status,
    ).toBe(404);
  });
  it("requires authentication for upload and every download", async () => {
    expect(
      (
        await POST(
          new NextRequest("http://localhost/upload", { method: "POST", body: "bytes" }),
          uploadContext,
        )
      ).status,
    ).toBe(401);
    expect((await GET(new NextRequest("http://localhost/content"), contentContext)).status).toBe(
      401,
    );
    expect(mocks.upload).not.toHaveBeenCalled();
    expect(mocks.download).not.toHaveBeenCalled();
  });
  it("passes authenticated actor and raw stream and redacts storage identity", async () => {
    const response = await POST(
      new NextRequest("http://localhost/upload", {
        method: "POST",
        body: "bytes",
        headers: {
          authorization: "Bearer test",
          "x-cce-filename": "file%20name.bin",
          "x-cce-client-message-id": randomUUID(),
          "content-type": "application/octet-stream",
        },
      }),
      uploadContext,
    );
    expect(response.status).toBe(201);
    expect(mocks.upload).toHaveBeenCalledWith(
      expect.objectContaining({ filename: "file name.bin", actorUserId: actor.id }),
      expect.anything(),
    );
    expect(await response.json()).not.toHaveProperty("storage");
    const meta = await metadata(
      new NextRequest("http://localhost/meta", { headers: { authorization: "Bearer test" } }),
      contentContext,
    );
    expect(await meta.json()).not.toHaveProperty("storage");
  });
  it("preserves same-origin cookie protection", async () => {
    const response = await POST(
      new NextRequest("http://localhost/upload", {
        method: "POST",
        body: "bytes",
        headers: { cookie: "cce_session=opaque", origin: "https://evil.test" },
      }),
      uploadContext,
    );
    expect(response.status).toBe(403);
    expect(mocks.upload).not.toHaveBeenCalled();
  });
  it("streams a range with safe delivery headers", async () => {
    const next = vi
      .fn()
      .mockResolvedValueOnce({ done: false, value: new Uint8Array([3, 4]) })
      .mockResolvedValue({ done: true });
    mocks.download.mockResolvedValue({
      attachment,
      range: { start: 2, end: 3 },
      bytes: { [Symbol.asyncIterator]: () => ({ next }) },
    });
    const response = await GET(
      new NextRequest("http://localhost/content", {
        headers: { authorization: "Bearer test", range: "bytes=2-3" },
      }),
      contentContext,
    );
    expect(response.status).toBe(206);
    expect(response.headers.get("content-range")).toBe("bytes 2-3/8");
    expect(response.headers.get("content-length")).toBe("2");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("content-disposition")).toMatch(/^inline;/);
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(new Uint8Array([3, 4]));
    expect(mocks.download).toHaveBeenCalledWith(
      expect.objectContaining({ range: "bytes=2-3", actorUserId: actor.id }),
    );
  });
  it("maps unsatisfiable ranges to 416 using the existing error envelope", async () => {
    mocks.download.mockRejectedValue(
      new ApplicationError("VALIDATION", "Requested range is not satisfiable.", { rangeSize: "8" }),
    );
    const response = await GET(
      new NextRequest("http://localhost/content", {
        headers: { authorization: "Bearer test", range: "bytes=99-" },
      }),
      contentContext,
    );
    expect(response.status).toBe(416);
    expect(response.headers.get("content-range")).toBe("bytes */8");
    expect(await response.json()).toMatchObject({ error: { code: "VALIDATION" } });
  });
  it("maps application errors without altering their authorization semantics", async () => {
    mocks.download.mockRejectedValue(
      new ApplicationError("NOT_FOUND", "Attachment was not found."),
    );
    const response = await GET(
      new NextRequest("http://localhost/content", { headers: { authorization: "Bearer test" } }),
      contentContext,
    );
    expect(response.status).toBe(404);
    expect(await response.json()).toMatchObject({ error: { code: "NOT_FOUND" } });
  });
});
