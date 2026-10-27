import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { uploadAttachments } from "./cce-upload-attachments.mjs";
const projectId = "00000000-0000-4000-8000-000000000001";
const attachmentId = "00000000-0000-4000-8000-000000000002";
const uploadId = "00000000-0000-4000-8000-000000000003";
const environment = {
  CCE_API_URL: "http://localhost:3001",
  CCE_MCP_ACCESS_TOKEN: "test-only-token",
};
test("reads supplied binary bytes and returns attachmentIds without local paths or filename captions", async () => {
  const root = await mkdtemp(join(tmpdir(), "cce-plugin-upload-"));
  try {
    const path = join(root, "evidence.bin"),
      bytes = Buffer.from([0, 255, 1, 2]);
    await writeFile(path, bytes);
    const capture = {
      projectId,
      source: "codex",
      captureScope: "partial",
      messages: [
        {
          role: "user",
          content: [{ type: "text", text: "Original authorized text" }],
          localAttachments: [{ path, mimeType: "application/octet-stream", uploadId }],
        },
      ],
    };
    let calls = 0;
    const result = await uploadAttachments(capture, {
      environment,
      fetcher: async (url, init) => {
        calls++;
        assert.equal(
          url.href,
          `http://localhost:3001/api/projects/${projectId}/imports/attachments`,
        );
        assert.deepEqual(init.body, bytes);
        assert.equal(init.redirect, "error");
        assert.equal(init.headers.Authorization, "Bearer test-only-token");
        assert.equal(init.headers["x-cce-filename"], "evidence.bin");
        assert.equal(init.headers["x-cce-upload-id"], uploadId);
        return Response.json({ attachmentId }, { status: 201 });
      },
    });
    assert.equal(calls, 1);
    assert.deepEqual(result.messages[0].content, capture.messages[0].content);
    assert.deepEqual(result.messages[0].attachmentIds, [attachmentId]);
    assert.ok(!JSON.stringify(result).includes(path));
    assert.ok(!JSON.stringify(result).includes("Attachment:"));
    assert.ok(!JSON.stringify(result).includes(environment.CCE_MCP_ACCESS_TOKEN));
    assert.ok(capture.messages[0].localAttachments);
    await assert.rejects(
      uploadAttachments(capture, {
        environment,
        fetcher: async () => new Response(null, { status: 403 }),
      }),
      /HTTP 403/u,
    );
    await assert.rejects(
      uploadAttachments(capture, {
        environment,
        fetcher: async () => Response.json({ attachmentId: "filename-only" }),
      }),
      /invalid attachment ID/u,
    );
    await writeFile(path, Buffer.alloc(0));
    await assert.rejects(uploadAttachments(capture, { environment }), /non-empty/u);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
test("rejects unsafe API origins and missing process credentials before uploading", async () => {
  for (const url of [
    "http://remote.example",
    "https://user:secret@example.test",
    "https://example.test/path",
    "https://example.test/?token=secret",
  ]) {
    await assert.rejects(
      uploadAttachments(
        { projectId, messages: [] },
        { environment: { ...environment, CCE_API_URL: url } },
      ),
      /CCE_API_URL/u,
    );
  }
  await assert.rejects(
    uploadAttachments(
      { projectId, messages: [] },
      { environment: { CCE_API_URL: "http://localhost:3001" } },
    ),
    /CCE_MCP_ACCESS_TOKEN/u,
  );
});
