import { randomBytes, randomUUID, createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import {
  createPostgresPool,
  runMigrations,
  seedDevelopmentIdentity,
  PostgresUnitOfWork,
} from "@cce/database";
import { conversationIdSchema, attachmentIdSchema } from "@cce/domain";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import {
  attachmentResponseSchema,
  conversationResponseSchema,
  messageListResponseSchema,
} from "@cce/api-contracts";
import { LocalAttachmentStorage } from "@cce/storage";
import { createServerRuntime, type ServerRuntime } from "../../apps/api/server/runtime";
import { createApiRouter } from "../../apps/api/router";
import { createStandaloneServer } from "../../apps/api/http-server";

vi.mock("next/server", () => {
  throw new Error("Next must never load for standalone MCP");
});
let container: StartedPostgreSqlContainer | undefined;
let maintenance: ReturnType<typeof createPostgresPool> | undefined;
const databaseName = `cce_test_${randomUUID().replaceAll("-", "")}`;
let databaseCreated = false;
let runtime: ServerRuntime;
let server: ReturnType<typeof createStandaloneServer>;
let root: string;
let origin: string;
let actor: Awaited<ReturnType<typeof seedDevelopmentIdentity>>;
let project: Awaited<ReturnType<ServerRuntime["projects"]["create"]>>;
const token = randomBytes(32).toString("hex");
const clients: Client[] = [];
async function connect(credential = token) {
  const client = new Client({ name: "local-plugin-integration", version: "1" });
  clients.push(client);
  const transport = new StreamableHTTPClientTransport(new URL("/mcp", origin), {
    requestInit: { headers: { Authorization: `Bearer ${credential}` } },
  });
  // SDK sessionId uses undefined with exactOptionalPropertyTypes; forward only the transport port.
  const bridge: Transport = {
    start: () => transport.start(),
    close: () => transport.close(),
    send: (message, options) => transport.send(message, options),
  };
  transport.onmessage = (message) => bridge.onmessage?.(message);
  transport.onerror = (error) => bridge.onerror?.(error);
  transport.onclose = () => bridge.onclose?.();
  await client.connect(bridge);
  return client;
}
async function uploadCapture(capture: unknown, credential = token) {
  const capturePath = join(root, randomUUID() + ".json");
  await writeFile(capturePath, JSON.stringify(capture));
  const child = spawn(
    process.execPath,
    [
      resolve("plugins/cce-conversation-submission/scripts/cce-upload-attachments.mjs"),
      capturePath,
    ],
    {
      env: { ...process.env, CCE_API_URL: origin, CCE_MCP_ACCESS_TOKEN: credential },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  let stdout = "",
    stderr = "";
  child.stdout.on("data", (chunk: Buffer) => {
    stdout += chunk.toString();
  });
  child.stderr.on("data", (chunk: Buffer) => {
    stderr += chunk.toString();
  });
  const code = await new Promise<number | null>((resolve, reject) => {
    child.once("exit", resolve);
    child.once("error", reject);
  });
  return { code, stdout, stderr };
}
beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), "cce-mcp-"));
  const configured = process.env["CCE_TEST_DATABASE_URL"];
  container = configured
    ? undefined
    : await new PostgreSqlContainer("postgres:18.6-alpine3.24").start();
  const databaseUrl = new URL(configured ?? container?.getConnectionUri() ?? "");
  databaseUrl.pathname = "/postgres";
  maintenance = createPostgresPool(databaseUrl.toString());
  await maintenance.query(`CREATE DATABASE "${databaseName}"`);
  databaseCreated = true;
  databaseUrl.pathname = `/${databaseName}`;
  runtime = createServerRuntime({
    DATABASE_URL: databaseUrl.toString(),
    NODE_ENV: "test",
    CCE_SESSION_SECRET: randomBytes(32).toString("hex"),
    CCE_ATTACHMENT_STORAGE_DIRECTORY: root,
    MODEL_BASE_URL: "http://127.0.0.1:1/v1",
    MODEL_CHAT_MODEL: "unused",
    MODEL_EXTRACTOR_MODEL: "unused",
    MODEL_CLASSIFIER_MODEL: "unused",
    MODEL_RESOLVER_MODEL: "unused",
    MODEL_REQUEST_TIMEOUT_MS: "1000",
  });
  await runMigrations(runtime.pool);
  actor = await seedDevelopmentIdentity(runtime.unitOfWork, {
    email: randomUUID() + "@example.test",
    displayName: "MCP user",
    apiToken: token,
  });
  project = await runtime.projects.create({ name: "Standalone MCP", actorUserId: actor.user.id });
  server = createStandaloneServer(createApiRouter(() => runtime));
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("No listener");
  origin = `http://127.0.0.1:${address.port}`;
});
afterAll(async () => {
  await Promise.all(clients.map((client) => client.close()));
  if (server) {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
  await runtime?.close();
  if (databaseCreated) await maintenance?.query(`DROP DATABASE "${databaseName}"`);
  await maintenance?.end();
  await container?.stop();
  if (root) await rm(root, { recursive: true, force: true });
});
const previewSchema = z.object({
  previewId: z.uuid(),
  messageCount: z.number(),
  attachments: z.array(z.object({ attachmentId: z.uuid(), checksum: z.string() })),
});
const resultSchema = z.object({ importId: z.uuid(), conversationId: z.uuid() });
describe("local plugin on the standalone API without Next", () => {
  it.each([
    ["pixel.png", "image/png"],
    ["preview.jpg", "image/jpeg"],
    ["preview.mp4", "video/mp4"],
    ["original.bin", "application/octet-stream"],
  ])(
    "persists plugin %s bytes, SQL association and reloaded DTOs with HTTP ranges",
    async (name, mime) => {
      const bytes =
        name === "pixel.png"
          ? Buffer.from(
              "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aX1sAAAAASUVORK5CYII=",
              "base64",
            )
          : name === "original.bin"
            ? Buffer.from([0, 255, 128, 1, 7])
            : await readFile(resolve("apps/vue/tests/fixtures", name));
      const path = join(root, name);
      await writeFile(path, bytes);
      const uploaded = await uploadCapture({
        projectId: project.id,
        source: "codex",
        captureScope: "partial",
        messages: [
          {
            role: "user",
            content: [{ type: "text", text: `Original ${name}` }],
            localAttachments: [{ path, mimeType: mime, uploadId: randomUUID() }],
          },
        ],
      });
      expect(uploaded.code, uploaded.stderr).toBe(0);
      const capture = z.record(z.string(), z.unknown()).parse(JSON.parse(uploaded.stdout));
      const ids = z
        .object({ messages: z.array(z.object({ attachmentIds: z.array(z.uuid()) })) })
        .parse(capture);
      const id = ids.messages[0]?.attachmentIds[0];
      if (!id) throw new Error("No real attachment ID");
      const staged = await runtime.pool.query(
        "SELECT id FROM import_attachment_uploads WHERE project_id = $1 AND id = $2",
        [project.id, id],
      );
      expect(staged.rows).toHaveLength(1);
      const client = await connect();
      const preview = previewSchema.parse(
        (await client.callTool({ name: "preview_conversation_import", arguments: capture }))
          .structuredContent,
      );
      const result = resultSchema.parse(
        (
          await client.callTool({
            name: "submit_conversation_import",
            arguments: { projectId: project.id, previewId: preview.previewId },
          })
        ).structuredContent,
      );
      const headers = { Authorization: `Bearer ${token}` };
      const conversationPath = `${origin}/api/projects/${project.id}/conversations/${result.conversationId}`;
      const conversation = conversationResponseSchema.parse(
        await (await fetch(conversationPath, { headers })).json(),
      );
      const messages = messageListResponseSchema.parse(
        await (await fetch(`${conversationPath}/messages`, { headers })).json(),
      );
      expect(conversation.attachments.map((a) => a.id)).toEqual([id]);
      expect(messages[0]?.attachments.map((a) => a.id)).toEqual([id]);
      const association = await runtime.pool.query(
        "SELECT a.id FROM attachments a JOIN messages m ON m.project_id = a.project_id AND m.conversation_id = a.conversation_id AND m.id = a.message_id WHERE a.project_id = $1 AND a.id = $2 AND m.conversation_id = $3",
        [project.id, id, result.conversationId],
      );
      expect(association.rows).toHaveLength(1);
      const url = `${origin}/api/projects/${project.id}/attachments/${id}/content`;
      const full = await fetch(url, { headers });
      expect(full.status).toBe(200);
      expect(full.headers.get("content-type")).toBe(mime);
      expect(full.headers.get("content-length")).toBe(String(bytes.length));
      expect(full.headers.get("accept-ranges")).toBe("bytes");
      expect(full.headers.get("content-range")).toBeNull();
      expect(Buffer.from(await full.arrayBuffer())).toEqual(bytes);
      for (const range of ["bytes=0-3", "bytes=-4", "bytes=4-"]) {
        const partial = await fetch(url, { headers: { ...headers, Range: range } });
        const start = range === "bytes=-4" ? bytes.length - 4 : range === "bytes=4-" ? 4 : 0;
        const end = range === "bytes=0-3" ? 3 : bytes.length - 1;
        expect(partial.status).toBe(206);
        expect(partial.headers.get("content-type")).toBe(mime);
        expect(partial.headers.get("content-length")).toBe(String(end - start + 1));
        expect(partial.headers.get("content-range")).toBe(`bytes ${start}-${end}/${bytes.length}`);
        expect(partial.headers.get("accept-ranges")).toBe("bytes");
        expect(Buffer.from(await partial.arrayBuffer())).toEqual(bytes.subarray(start, end + 1));
      }
      for (const range of [
        `bytes=${bytes.length}-`,
        "bytes=3-1",
        "bytes=0-1,3-4",
        "bytes=-0",
        "nonsense",
      ]) {
        const invalid = await fetch(url, { headers: { ...headers, Range: range } });
        expect(invalid.status).toBe(416);
        expect(invalid.headers.get("content-range")).toBe(`bytes */${bytes.length}`);
        expect(invalid.headers.get("accept-ranges")).toBe("bytes");
      }
      expect((await fetch(url)).status).toBe(401);
      expect((await fetch(url, { headers: { Authorization: "Bearer invalid" } })).status).toBe(401);
      const other = await runtime.projects.create({
        name: "Other scope",
        actorUserId: actor.user.id,
      });
      expect((await fetch(url.replace(project.id, other.id), { headers })).status).toBe(404);
      expect((await fetch(url.replace(id, randomUUID()), { headers })).status).toBe(404);
    },
  );

  it("rejects WebM media under the current protocol and allows exact bytes as generic binary", async () => {
    const bytes = new Uint8Array([0x1a, 0x45, 0xdf, 0xa3, 0x81, 0]);
    const url = `${origin}/api/projects/${project.id}/imports/attachments`;
    for (const mime of ["video/webm", "application/octet-stream"]) {
      const response = await fetch(url, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "content-type": mime,
          "x-cce-filename": "clip.webm",
          "x-cce-upload-id": randomUUID(),
        },
        body: bytes,
      });
      expect(response.status).toBe(mime === "video/webm" ? 422 : 201);
    }
  });

  it("streams a 32 MiB object with bounded storage reads and verifies the complete HTTP checksum", async () => {
    const size = 32 * 1024 * 1024;
    const block = new Uint8Array(64 * 1024).fill(37);
    const expected = createHash("sha256");
    const storage = new LocalAttachmentStorage(root);
    const conversation = await runtime.conversations.create({
      projectId: project.id,
      actorUserId: actor.user.id,
      title: "Large stream",
    });
    let sent = 0;
    const uploadOptions: RequestInit & { duplex: "half" } = {
      method: "POST",
      duplex: "half",
      headers: {
        Authorization: `Bearer ${token}`,
        "content-type": "application/octet-stream",
        "x-cce-filename": "large.bin",
        "x-cce-client-message-id": randomUUID(),
      },
      body: new ReadableStream<Uint8Array>({
        pull(controller) {
          if (sent === size) {
            controller.close();
            return;
          }
          expected.update(block);
          controller.enqueue(block);
          sent += block.length;
        },
      }),
    };
    const uploaded = await fetch(
      `${origin}/api/projects/${project.id}/conversations/${conversation.id}/attachments`,
      uploadOptions,
    );
    expect(uploaded.status).toBe(201);
    const dto = attachmentResponseSchema.parse(await uploaded.json());
    const attachment = await new PostgresUnitOfWork(runtime.pool).runWithAttachments(
      (repositories) => repositories.attachments.find(project.id, attachmentIdSchema.parse(dto.id)),
    );
    if (!attachment) throw new Error("Large upload was not persisted");
    const iterator = (await storage.open(attachment.storage, size))[Symbol.asyncIterator]();
    let total = 0;
    while (true) {
      const chunk = await iterator.next();
      if (chunk.done) break;
      expect(chunk.value.byteLength).toBeLessThanOrEqual(64 * 1024);
      total += chunk.value.byteLength;
    }
    expect(total).toBe(size);
    const response = await fetch(
      `${origin}/api/projects/${project.id}/attachments/${attachment.id}/content`,
      { headers: { Authorization: `Bearer ${token}` } },
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("content-length")).toBe(String(size));
    const reader = response.body?.getReader();
    if (!reader) throw new Error("No HTTP stream");
    const actual = createHash("sha256");
    total = 0;
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      actual.update(chunk.value);
      total += chunk.value.byteLength;
    }
    expect(total).toBe(size);
    expect(actual.digest("hex")).toBe(expected.digest("hex"));
  });
  it("previews and submits text with idempotency, provenance and unchanged Context", async () => {
    const client = await connect();
    const before = await runtime.conversations.list(project.id, actor.user.id);
    const capture = {
      projectId: project.id,
      source: "codex",
      captureScope: "partial",
      messages: [
        {
          role: "user",
          externalMessageId: "genuine-invocation-id",
          content: [{ type: "text", text: "Authorized original text" }],
        },
      ],
    };
    const preview = previewSchema.parse(
      (await client.callTool({ name: "preview_conversation_import", arguments: capture }))
        .structuredContent,
    );
    expect(await runtime.conversations.list(project.id, actor.user.id)).toHaveLength(before.length);
    const args = { projectId: project.id, previewId: preview.previewId };
    const result = resultSchema.parse(
      (await client.callTool({ name: "submit_conversation_import", arguments: args }))
        .structuredContent,
    );
    expect(
      (await client.callTool({ name: "submit_conversation_import", arguments: args }))
        .structuredContent,
    ).toMatchObject(result);
    const second = previewSchema.parse(
      (await client.callTool({ name: "preview_conversation_import", arguments: capture }))
        .structuredContent,
    );
    expect(
      (
        await client.callTool({
          name: "submit_conversation_import",
          arguments: { projectId: project.id, previewId: second.previewId },
        })
      ).structuredContent,
    ).toMatchObject(result);
    const unit = new PostgresUnitOfWork(runtime.pool);
    await unit.run(async (repositories) => {
      const messages = await repositories.conversations.listMessages(
        project.id,
        conversationIdSchema.parse(result.conversationId),
      );
      expect(messages).toHaveLength(1);
      expect(messages[0]).toMatchObject({
        content: "Authorized original text",
        providerMessageId: "genuine-invocation-id",
      });
      expect((await repositories.projects.findById(project.id))?.headCommitId).toBe(
        project.headCommitId,
      );
      expect((await repositories.imports.findById(project.id, result.importId))?.createdBy).toBe(
        actor.user.id,
      );
    });
  });
  it("uploads actual binary bytes before preview and atomically binds attachmentIds at submit", async () => {
    const bytes = new Uint8Array([0, 255, 7, 8, 9]);
    const filename = join(root, "authorized.bin");
    await writeFile(filename, bytes);
    const uploadId = randomUUID();
    const capture = {
      projectId: project.id,
      source: "codex",
      captureScope: "partial",
      messages: [
        {
          role: "user",
          content: [{ type: "text", text: "Original file evidence" }],
          localAttachments: [{ path: filename, mimeType: "application/octet-stream", uploadId }],
        },
      ],
    };
    const before = await runtime.conversations.list(project.id, actor.user.id);
    const uploaded = await uploadCapture(capture);
    expect(uploaded.code, uploaded.stderr).toBe(0);
    const normalized = z
      .object({ messages: z.array(z.object({ attachmentIds: z.array(z.uuid()) })) })
      .passthrough()
      .parse(JSON.parse(uploaded.stdout));
    const attachmentId = normalized.messages[0]?.attachmentIds[0];
    expect(attachmentId).toBeDefined();
    expect(uploaded.stdout).not.toContain(filename);
    expect(uploaded.stdout).not.toContain(token);
    expect(await runtime.conversations.list(project.id, actor.user.id)).toHaveLength(before.length);
    expect(JSON.parse((await uploadCapture(capture)).stdout)).toEqual(JSON.parse(uploaded.stdout));
    const client = await connect();
    const preview = previewSchema.parse(
      (
        await client.callTool({
          name: "preview_conversation_import",
          arguments: z.record(z.string(), z.unknown()).parse(JSON.parse(uploaded.stdout)),
        })
      ).structuredContent,
    );
    expect(preview.attachments).toEqual(
      [
        {
          attachmentId,
          filename: "authorized.bin",
          byteSize: 5,
          checksum: createHash("sha256").update(bytes).digest("hex"),
        },
      ].map(({ attachmentId, checksum }) => ({ attachmentId, checksum })),
    );
    const args = { projectId: project.id, previewId: preview.previewId };
    const result = resultSchema.parse(
      (await client.callTool({ name: "submit_conversation_import", arguments: args }))
        .structuredContent,
    );
    expect(
      (await client.callTool({ name: "submit_conversation_import", arguments: args }))
        .structuredContent,
    ).toMatchObject(result);
    // A later conflicting attachment must roll back the earlier binding and new Conversation.
    const retryCapture = {
      ...capture,
      messages: [
        {
          ...capture.messages[0],
          content: [{ type: "text", text: "Second authorized request" }],
          localAttachments: [
            { path: filename, mimeType: "application/octet-stream", uploadId: randomUUID() },
          ],
        },
      ],
    };
    const retryUploaded = await uploadCapture(retryCapture);
    expect(retryUploaded.code).toBe(0);
    const retryInput = z
      .object({
        projectId: z.uuid(),
        source: z.literal("codex"),
        captureScope: z.literal("partial"),
        messages: z.array(
          z.object({
            role: z.literal("user"),
            content: z.array(z.object({ type: z.literal("text"), text: z.string() })),
            attachmentIds: z.array(z.uuid()),
          }),
        ),
      })
      .parse(JSON.parse(retryUploaded.stdout));
    const retryMessage = retryInput.messages[0];
    if (!retryMessage || !attachmentId) throw new Error("Missing uploaded message");
    const freshId = retryMessage.attachmentIds[0];
    if (!freshId) throw new Error("Missing fresh upload");
    retryMessage.attachmentIds.push(attachmentId);
    const failedPreview = previewSchema.parse(
      (await client.callTool({ name: "preview_conversation_import", arguments: retryInput }))
        .structuredContent,
    );
    const countBeforeFailure = await runtime.conversations.list(project.id, actor.user.id);
    expect(
      (
        await client.callTool({
          name: "submit_conversation_import",
          arguments: { projectId: project.id, previewId: failedPreview.previewId },
        })
      ).isError,
    ).toBe(true);
    expect(await runtime.conversations.list(project.id, actor.user.id)).toHaveLength(
      countBeforeFailure.length,
    );
    await new PostgresUnitOfWork(runtime.pool).runWithAttachments(async (repositories) => {
      expect(
        await repositories.attachments.find(project.id, attachmentIdSchema.parse(freshId)),
      ).toBeNull();
      expect(
        await repositories.attachments.listEvents(project.id, attachmentIdSchema.parse(freshId)),
      ).toEqual([]);
    });
    const response = await fetch(
      `${origin}/api/projects/${project.id}/attachments/${attachmentId}/content`,
      { headers: { Authorization: `Bearer ${token}` } },
    );
    expect(response.status).toBe(200);
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(bytes);
    const messages = await runtime.conversations.listMessages({
      projectId: project.id,
      actorUserId: actor.user.id,
      conversationId: conversationIdSchema.parse(result.conversationId),
    });
    expect(messages).toHaveLength(1);
    expect(messages[0]?.content).toBe("Original file evidence");
    expect(
      (
        await uploadCapture(
          {
            ...capture,
            messages: [
              {
                ...capture.messages[0],
                localAttachments: [
                  { path: filename, mimeType: "application/octet-stream", uploadId },
                ],
              },
            ],
          },
          "invalid",
        )
      ).code,
    ).not.toBe(0);
    await writeFile(filename, new Uint8Array([9]));
    expect((await uploadCapture(capture)).code).not.toBe(0);
  });
  it("rejects invalid tokens and unauthorized projects for MCP and binary upload", async () => {
    await expect(connect("invalid")).rejects.toThrow();
    for (const method of ["GET", "POST", "DELETE"]) {
      const response = await fetch(new URL("/mcp", origin), {
        method,
        headers: { Authorization: "Bearer invalid", "content-type": "application/json" },
        ...(method === "POST" ? { body: "{}" } : {}),
      });
      expect(response.status).toBe(401);
    }
    const other = await seedDevelopmentIdentity(runtime.unitOfWork, {
      email: randomUUID() + "@example.test",
      displayName: "Other",
      apiToken: randomBytes(32).toString("hex"),
    });
    const hidden = await runtime.projects.create({ name: "Hidden", actorUserId: other.user.id });
    const client = await connect();
    const failure = await client.callTool({
      name: "preview_conversation_import",
      arguments: {
        projectId: hidden.id,
        source: "codex",
        captureScope: "partial",
        messages: [{ role: "user", content: [{ type: "text", text: "no access" }] }],
      },
    });
    expect(failure.isError).toBe(true);
    const response = await fetch(`${origin}/api/projects/${hidden.id}/imports/attachments`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "x-cce-filename": "no.bin",
        "x-cce-upload-id": randomUUID(),
        "content-type": "application/octet-stream",
      },
      body: new Uint8Array([1]),
    });
    expect(response.status).toBe(404);
  });

  it("returns 403 for viewer writes, permits authorized media reads and never binds filename text", async () => {
    const viewerToken = randomBytes(32).toString("hex");
    const viewer = await seedDevelopmentIdentity(runtime.unitOfWork, {
      email: randomUUID() + "@example.test",
      displayName: "Viewer",
      apiToken: viewerToken,
    });
    await runtime.projects.addMember({
      projectId: project.id,
      actorUserId: actor.user.id,
      memberEmail: viewer.user.email,
      role: "viewer",
    });
    const response = await fetch(`${origin}/api/projects/${project.id}/imports/attachments`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${viewerToken}`,
        "content-type": "application/octet-stream",
        "x-cce-filename": "evidence.bin",
        "x-cce-upload-id": randomUUID(),
      },
      body: new Uint8Array([1]),
    });
    expect(response.status).toBe(403);
    const client = await connect(viewerToken);
    expect(
      (
        await client.callTool({
          name: "preview_conversation_import",
          arguments: {
            projectId: project.id,
            source: "codex",
            captureScope: "partial",
            messages: [
              { role: "user", content: [{ type: "text", text: "Attachment: evidence.bin" }] },
            ],
          },
        })
      ).isError,
    ).toBe(true);
    const ownerClient = await connect();
    const preview = previewSchema.parse(
      (
        await ownerClient.callTool({
          name: "preview_conversation_import",
          arguments: {
            projectId: project.id,
            source: "codex",
            captureScope: "partial",
            messages: [
              { role: "user", content: [{ type: "text", text: "Attachment: evidence.bin" }] },
            ],
          },
        })
      ).structuredContent,
    );
    expect(preview.attachments).toEqual([]);
    expect(
      (
        await client.callTool({
          name: "submit_conversation_import",
          arguments: {
            projectId: project.id,
            previewId: preview.previewId,
          },
        })
      ).isError,
    ).toBe(true);
    const result = resultSchema.parse(
      (
        await ownerClient.callTool({
          name: "submit_conversation_import",
          arguments: {
            projectId: project.id,
            previewId: preview.previewId,
          },
        })
      ).structuredContent,
    );
    const messages = messageListResponseSchema.parse(
      await (
        await fetch(
          `${origin}/api/projects/${project.id}/conversations/${result.conversationId}/messages`,
          {
            headers: { Authorization: `Bearer ${token}` },
          },
        )
      ).json(),
    );
    expect(messages[0]?.attachments).toEqual([]);
    const attachments = await runtime.pool.query<{ id: string }>(
      "SELECT id FROM attachments WHERE project_id = $1 LIMIT 1",
      [project.id],
    );
    const id = attachments.rows[0]?.id;
    if (!id) throw new Error("Missing real attachment");
    const url = `${origin}/api/projects/${project.id}/attachments/${id}/content`;
    const readable = await fetch(url, { headers: { Authorization: `Bearer ${viewerToken}` } });
    expect(readable.status).toBe(200);
    await readable.arrayBuffer();
    const foreignToken = randomBytes(32).toString("hex");
    await seedDevelopmentIdentity(runtime.unitOfWork, {
      email: randomUUID() + "@example.test",
      displayName: "Nonmember",
      apiToken: foreignToken,
    });
    expect(
      (
        await fetch(url, {
          headers: { Authorization: `Bearer ${foreignToken}`, Range: "bytes=0-3" },
        })
      ).status,
    ).toBe(404);
  });
});
