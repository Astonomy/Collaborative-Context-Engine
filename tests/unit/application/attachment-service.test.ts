import { createHash } from "node:crypto";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  AttachmentService,
  ConversationImportService,
  MediaProcessingService,
  maximumAttachmentBytes,
  type AttachmentRepository,
  type ImportAttachment,
  type AttachmentUnitOfWork,
} from "@cce/application";
import {
  attachmentIdSchema,
  conversationIdSchema,
  projectIdSchema,
  userIdSchema,
  type Attachment,
  type AttachmentEvent,
  type ProjectRole,
} from "@cce/domain";
import { LocalAttachmentStorage } from "@cce/storage";
import { HeaderMediaInspector } from "@cce/storage/media-server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createFixture, idsFrom, seedConversation, uuid } from "./fixtures";

const roots: string[] = [];
afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});
async function* bytes(value = new Uint8Array([1, 2, 3, 4])) {
  yield value.subarray(0, 2);
  yield value.subarray(2);
}
async function collect(source: AsyncIterable<Uint8Array>) {
  const result: number[] = [];
  for await (const chunk of source) result.push(...chunk);
  return result;
}
async function setup(role: ProjectRole = "owner") {
  const fixture = createFixture(role);
  const { conversation, message } = seedConversation(fixture);
  const records: Attachment[] = [];
  const events: AttachmentEvent[] = [];
  const uploads: ImportAttachment[] = [];
  const attachments: AttachmentRepository = {
    async insertImportUpload(upload) {
      uploads.push(upload);
    },
    async findImportUpload(p, id) {
      return uploads.find((a) => a.projectId === p && a.id === id) ?? null;
    },
    async findImportUploadByRequest(p, actor, id) {
      return (
        uploads.find((a) => a.projectId === p && a.actorUserId === actor && a.uploadId === id) ??
        null
      );
    },
    async insert(a) {
      records.push(a);
    },
    async find(p, id) {
      return records.find((a) => a.projectId === p && a.id === id) ?? null;
    },
    async listForMessage(p, m) {
      return records.filter((a) => a.projectId === p && a.messageId === m);
    },
    async listForConversation(p, c) {
      return records.filter((a) => a.projectId === p && a.conversationId === c);
    },
    async appendEvent(event) {
      events.push(event);
    },
    async listEvents(p, id) {
      return events.filter((e) => e.projectId === p && e.attachmentId === id);
    },
  };
  const uow: AttachmentUnitOfWork = {
    runWithAttachments: (operation) =>
      fixture.unitOfWork.run((r) => operation({ ...r, attachments })),
  };
  const root = await mkdtemp(join(tmpdir(), "cce-attachment-"));
  roots.push(root);
  const storage = new LocalAttachmentStorage(root);
  const put = vi.spyOn(storage, "put");
  const open = vi.spyOn(storage, "open");
  const service = new AttachmentService(uow, storage, idsFrom(100), fixture.clock);
  const input = {
    projectId: fixture.project.id,
    conversationId: conversation.id,
    actorUserId: fixture.user.id,
    clientMessageId: uuid(88),
    filename: "data.bin",
    declaredMimeType: "application/octet-stream",
  };
  return {
    ...fixture,
    conversation,
    message,
    records,
    events,
    service,
    uploads,
    imports: new ConversationImportService(
      { run: (operation) => uow.runWithAttachments(operation) },
      idsFrom(200),
      fixture.clock,
    ),
    input,
    storage,
    put,
    open,
    root,
  };
}

describe("Attachment binary lifecycle", () => {
  it("stages an actual binary without evidence, then binds it to the original message on confirmation", async () => {
    const f = await setup();
    const input = {
      projectId: f.project.id,
      actorUserId: f.user.id,
      uploadId: uuid(89),
      filename: "original.bin",
      declaredMimeType: "application/octet-stream",
    };
    const upload = await f.service.uploadForImport(input, bytes());
    expect(f.records).toHaveLength(0);
    expect(f.events).toHaveLength(0);
    expect(await f.service.uploadForImport(input, bytes())).toEqual(upload);
    await expect(
      f.service.uploadForImport(input, bytes(new Uint8Array([9]))),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    const submission = {
      source: "codex" as const,
      captureScope: "partial" as const,
      messages: [
        {
          role: "user" as const,
          content: [{ type: "text" as const, text: "Original authorized request" }],
          attachmentIds: [upload.id],
          metadata: {},
        },
      ],
      metadata: {},
    };
    const preview = await f.imports.previewProviderSubmission({
      projectId: f.project.id,
      actorUserId: f.user.id,
      submission,
    });
    expect(preview.messageCount).toBe(1);
    expect(preview.attachments).toMatchObject([{ attachmentId: upload.id, byteSize: 4 }]);
    expect(f.records).toHaveLength(0);
    const result = await f.imports.submitProviderPreview({
      projectId: f.project.id,
      actorUserId: f.user.id,
      previewId: preview.id,
    });
    expect(f.records).toHaveLength(1);
    expect(f.records[0]?.id).toBe(upload.id);
    const conversation = result.importedConversations[0];
    if (!conversation) throw new Error("Missing evidence");
    const messages = await f.unitOfWork.run((r) =>
      r.conversations.listMessages(f.project.id, conversation.conversationId),
    );
    expect(messages).toHaveLength(1);
    expect(messages[0]?.content).toBe("Original authorized request");
    expect(f.records[0]?.messageId).toBe(messages[0]?.id);
    expect(
      await f.imports.submitProviderPreview({
        projectId: f.project.id,
        actorUserId: f.user.id,
        previewId: preview.id,
      }),
    ).toEqual(result);
    expect(f.records).toHaveLength(1);
    const duplicate = await f.imports.previewProviderSubmission({
      projectId: f.project.id,
      actorUserId: f.user.id,
      submission,
    });
    expect(duplicate.duplicateStatus).toBe("duplicate");
    expect(
      await f.imports.submitProviderPreview({
        projectId: f.project.id,
        actorUserId: f.user.id,
        previewId: duplicate.id,
      }),
    ).toEqual(result);
    await expect(
      f.imports.previewProviderSubmission({
        projectId: f.project.id,
        actorUserId: f.user.id,
        submission: { ...submission, messages: [...submission.messages, ...submission.messages] },
      }),
    ).rejects.toMatchObject({ code: "VALIDATION" });
    const altered = await f.imports.previewProviderSubmission({
      projectId: f.project.id,
      actorUserId: f.user.id,
      submission: { ...submission, title: "Changed capture" },
    });
    await expect(
      f.imports.submitProviderPreview({
        projectId: f.project.id,
        actorUserId: f.user.id,
        previewId: altered.id,
      }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
  });
  it("rejects foreign, expired, missing and unsupported attachment bindings", async () => {
    const f = await setup();
    const input = {
      projectId: f.project.id,
      actorUserId: f.user.id,
      uploadId: uuid(89),
      filename: "original.bin",
      declaredMimeType: "application/octet-stream",
    };
    const upload = await f.service.uploadForImport(input, bytes());
    const submission = {
      source: "codex" as const,
      captureScope: "partial" as const,
      messages: [
        {
          role: "user" as const,
          content: [{ type: "text" as const, text: "Original message" }],
          attachmentIds: [upload.id],
          metadata: {},
        },
      ],
      metadata: {},
    };
    const previewInput = { projectId: f.project.id, actorUserId: f.user.id, submission };
    f.uploads[0] = { ...upload, actorUserId: userIdSchema.parse(uuid(999)) };
    await expect(f.imports.previewProviderSubmission(previewInput)).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    f.uploads[0] = { ...upload, expiresAt: "2000-01-01T00:00:00.000Z" };
    await expect(f.imports.previewProviderSubmission(previewInput)).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    f.uploads[0] = { ...upload, projectId: projectIdSchema.parse(uuid(999)) };
    await expect(f.imports.previewProviderSubmission(previewInput)).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    f.uploads[0] = upload;
    await expect(
      f.imports.previewProviderSubmission({
        ...previewInput,
        submission: {
          ...submission,
          messages: [
            {
              content: [{ type: "text", text: "Original message" }],
              metadata: {},
              role: "unknown",
              attachmentIds: [upload.id],
            },
          ],
        },
      }),
    ).rejects.toMatchObject({ code: "VALIDATION" });
    await expect(
      f.service.uploadForImport({ ...input, uploadId: "bad" }, bytes()),
    ).rejects.toMatchObject({ code: "VALIDATION" });
    const viewer = await setup("viewer");
    await expect(
      viewer.service.uploadForImport(
        { ...input, projectId: viewer.project.id, actorUserId: viewer.user.id },
        bytes(),
      ),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(viewer.put).not.toHaveBeenCalled();
  });
  it("fails closed before storage when an attachment's conversation cannot be resolved in its project", async () => {
    const f = await setup();
    const attachment = await f.service.upload(f.input, bytes());
    vi.spyOn(f.unitOfWork.repositories.conversations, "find").mockResolvedValueOnce(null);
    await expect(
      f.service.download({
        projectId: attachment.projectId,
        attachmentId: attachment.id,
        actorUserId: f.user.id,
        range: "bytes=0-1",
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(f.open).not.toHaveBeenCalled();
  });
  it("rediscovers persisted attachments and enforces conversation scope", async () => {
    const f = await setup();
    const attachment = await f.service.upload(f.input, bytes());
    const input = {
      projectId: f.input.projectId,
      conversationId: f.input.conversationId,
      actorUserId: f.user.id,
    };
    expect(await f.service.list(input)).toEqual([attachment]);
    await expect(
      f.service.list({ ...input, conversationId: conversationIdSchema.parse(uuid(990)) }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(
      f.service.list({ ...input, actorUserId: userIdSchema.parse(uuid(991)) }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(
      f.service.list({ ...input, projectId: projectIdSchema.parse(uuid(992)) }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
  it("inspects stored bytes without changing source evidence, even when parsing fails", async () => {
    const f = await setup();
    const data = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
    const attachment = await f.service.upload(
      { ...f.input, filename: "truncated.png" },
      bytes(data),
    );
    const original = structuredClone({
      records: f.records,
      events: f.events,
      view: f.unitOfWork.view(),
    });
    const media = new MediaProcessingService(f.service, new HeaderMediaInspector());
    const input = {
      projectId: attachment.projectId,
      attachmentId: attachment.id,
      actorUserId: f.user.id,
    };
    expect(await media.inspect(input)).toMatchObject({
      status: "failed",
      error: "inspection-failed",
      description: { preview: "download" },
    });
    expect(await collect((await f.service.download(input)).bytes)).toEqual([...data]);
    expect({ records: f.records, events: f.events, view: f.unitOfWork.view() }).toEqual(original);
    f.open.mockClear();
    await expect(
      media.inspect({ ...input, projectId: projectIdSchema.parse(uuid(902)) }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(f.open).not.toHaveBeenCalled();
  });
  it("detects MP4 bytes and streams them for authorized viewers", async () => {
    const f = await setup();
    const data = new Uint8Array([0, 0, 0, 16, 102, 116, 121, 112, 105, 115, 111, 109, 0, 0, 0, 0]);
    const a = await f.service.upload(
      { ...f.input, filename: "clip.mp4", declaredMimeType: "video/mp4" },
      bytes(data),
    );
    expect(a.mediaKind).toBe("video");
    await f.unitOfWork.repositories.projects.updateMemberRole({ ...f.member, role: "viewer" });
    const result = await f.service.download({
      projectId: a.projectId,
      attachmentId: a.id,
      actorUserId: f.user.id,
      range: "bytes=4-7",
    });
    expect(await collect(result.bytes)).toEqual([102, 116, 121, 112]);
  });
  it("rejects archived project and conversation uploads before writing", async () => {
    const f = await setup();
    vi.spyOn(f.unitOfWork.repositories.projects, "findAccess").mockResolvedValueOnce({
      project: { ...f.project, archivedAt: f.clock.now().toISOString() },
      member: f.member,
    });
    await expect(f.service.upload(f.input, bytes())).rejects.toMatchObject({ code: "CONFLICT" });
    vi.spyOn(f.unitOfWork.repositories.conversations, "find").mockResolvedValueOnce({
      ...f.conversation,
      status: "archived",
      archivedAt: f.clock.now().toISOString(),
    });
    await expect(f.service.upload(f.input, bytes())).rejects.toMatchObject({ code: "CONFLICT" });
    expect(f.put).not.toHaveBeenCalled();
  });
  it("roundtrips bytes with immutable new message binding, server hash and no HEAD movement", async () => {
    const f = await setup();
    const a = await f.service.upload({ ...f.input, filename: "../../private\\safe.bin" }, bytes());
    expect(a.originalFilename).toBe("safe.bin");
    expect(a.messageId).not.toBe(f.message.id);
    expect(a.checksum.value).toBe(
      createHash("sha256")
        .update(new Uint8Array([1, 2, 3, 4]))
        .digest("hex"),
    );
    expect(a.storage.key).not.toContain("safe");
    const result = await f.service.download({
      projectId: a.projectId,
      attachmentId: a.id,
      actorUserId: f.user.id,
    });
    expect(await collect(result.bytes)).toEqual([1, 2, 3, 4]);
    expect(f.unitOfWork.view().messages).toContainEqual(f.message);
    expect(f.unitOfWork.view().commits).toEqual([f.genesis]);
    expect(f.unitOfWork.view().auditEvents).toMatchObject([{ action: "message.created" }]);
  });
  it("rejects viewer upload before consuming bytes", async () => {
    const f = await setup("viewer");
    await expect(f.service.upload(f.input, bytes())).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(f.put).not.toHaveBeenCalled();
  });
  it("rejects foreign actors, projects and conversations before storage", async () => {
    const f = await setup();
    for (const input of [
      { ...f.input, actorUserId: userIdSchema.parse(uuid(901)) },
      { ...f.input, projectId: projectIdSchema.parse(uuid(902)) },
      { ...f.input, conversationId: conversationIdSchema.parse(uuid(903)) },
    ])
      await expect(f.service.upload(input, bytes())).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(f.put).not.toHaveBeenCalled();
  });
  it("does not bind to an existing message client ID", async () => {
    const f = await setup();
    await expect(
      f.service.upload({ ...f.input, clientMessageId: uuid(7) }, bytes()),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    expect(f.records).toHaveLength(0);
    expect(f.unitOfWork.view().messages).toEqual([f.message]);
  });
  it("returns the same evidence for exact retries and rejects changed bytes", async () => {
    const f = await setup();
    const a = await f.service.upload(f.input, bytes());
    expect(await f.service.upload(f.input, bytes())).toEqual(a);
    await expect(f.service.upload(f.input, bytes(new Uint8Array([9])))).rejects.toMatchObject({
      code: "CONFLICT",
    });
    expect(f.records).toHaveLength(1);
  });
  it.each([
    { filename: "test.svg" },
    { filename: "test.exe.png" },
    { filename: ".." },
    { declaredMimeType: "image/png; charset=utf8" },
    { declaredMimeType: "bad\r\nmime" },
    { declaredMimeType: "image/png" },
  ])("rejects unsafe upload metadata or MIME %j", async (change) => {
    const f = await setup();
    await expect(f.service.upload({ ...f.input, ...change }, bytes())).rejects.toMatchObject({
      code: "VALIDATION",
    });
    expect(f.records).toHaveLength(0);
    expect(await readdir(f.root)).toEqual([]);
  });
  it("accepts unknown types only as inert binary and detects signatures independently", async () => {
    const f = await setup();
    const a = await f.service.upload(
      { ...f.input, declaredMimeType: "application/x-unknown" },
      bytes(),
    );
    expect(a).toMatchObject({ detectedMimeType: "application/octet-stream", mediaKind: "binary" });
    const png = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
    const b = await f.service.upload({ ...f.input, clientMessageId: uuid(89) }, bytes(png));
    expect(b).toMatchObject({ detectedMimeType: "image/png", mediaKind: "image" });
    await expect(
      f.service.upload({ ...f.input, declaredMimeType: "image/jpeg" }, bytes(png)),
    ).rejects.toMatchObject({ code: "VALIDATION" });
  });
  it("bounds streaming uploads, rejects empty bytes and removes partial files", async () => {
    const f = await setup();
    async function* oversized() {
      const chunk = new Uint8Array(1024 * 1024);
      for (let n = 0; n <= maximumAttachmentBytes / chunk.length; n++) yield chunk;
    }
    await expect(f.service.upload(f.input, oversized())).rejects.toMatchObject({
      code: "VALIDATION",
    });
    await expect(f.service.upload(f.input, bytes(new Uint8Array()))).rejects.toMatchObject({
      code: "VALIDATION",
    });
    expect(await readdir(f.root)).toEqual([]);
  });
  it("checks read membership, scoped object identity and latest availability before opening storage", async () => {
    const f = await setup();
    const a = await f.service.upload(f.input, bytes());
    const input = { projectId: a.projectId, attachmentId: a.id, actorUserId: f.user.id };
    for (const change of [
      { actorUserId: userIdSchema.parse(uuid(901)) },
      { projectId: projectIdSchema.parse(uuid(902)) },
      { attachmentId: attachmentIdSchema.parse(uuid(903)) },
    ]) {
      await expect(f.service.download({ ...input, ...change })).rejects.toMatchObject({
        code: "NOT_FOUND",
      });
    }
    f.events.length = 0;
    await expect(f.service.download(input)).rejects.toMatchObject({ code: "CONFLICT" });
    expect(f.open).not.toHaveBeenCalled();
  });
  it.each([
    ["bytes=1-2", [2, 3]],
    ["bytes=2-", [3, 4]],
    ["bytes=-2", [3, 4]],
    ["bytes=0-99", [1, 2, 3, 4]],
  ])("streams range %s", async (range, expected) => {
    const f = await setup();
    const a = await f.service.upload(f.input, bytes());
    const result = await f.service.download({
      projectId: a.projectId,
      attachmentId: a.id,
      actorUserId: f.user.id,
      range: String(range),
    });
    expect(await collect(result.bytes)).toEqual(expected);
  });
  it.each([
    "bytes=9-",
    "bytes=3-1",
    "bytes=-0",
    "bytes=0-1,2-3",
    "invalid",
    "bytes=9007199254740993-",
  ])("rejects range %s", async (range) => {
    const f = await setup();
    const a = await f.service.upload(f.input, bytes());
    await expect(
      f.service.download({
        projectId: a.projectId,
        attachmentId: a.id,
        actorUserId: f.user.id,
        range,
      }),
    ).rejects.toMatchObject({ code: "VALIDATION", details: { rangeSize: "4" } });
    expect(f.open).not.toHaveBeenCalled();
  });
  it("rechecks authorization after streaming and never binds after revocation", async () => {
    const f = await setup();
    async function* revoked() {
      yield new Uint8Array([1]);
      vi.spyOn(f.unitOfWork.repositories.projects, "findAccess").mockResolvedValue(null);
    }
    await expect(f.service.upload(f.input, revoked())).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(f.records).toHaveLength(0);
  });
  it("sanitizes storage errors without exposing filesystem paths or secrets", async () => {
    const f = await setup();
    f.put.mockRejectedValueOnce(new Error("secret /private/path"));
    await expect(f.service.upload(f.input, bytes())).rejects.toMatchObject({
      code: "DEPENDENCY_UNAVAILABLE",
      message: "Attachment storage is unavailable.",
    });
    const a = await f.service.upload(f.input, bytes());
    f.open.mockRejectedValueOnce(new Error("secret /private/path"));
    await expect(
      f.service.download({ projectId: a.projectId, attachmentId: a.id, actorUserId: f.user.id }),
    ).rejects.toMatchObject({
      code: "DEPENDENCY_UNAVAILABLE",
      message: "Attachment storage is unavailable.",
    });
  });
});
