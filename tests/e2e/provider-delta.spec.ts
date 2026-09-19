import { randomUUID } from "node:crypto";
import {
  conversationImportResponseSchema,
  conversationListResponseSchema,
  messageListResponseSchema,
  projectResponseSchema,
  providerConversationImportPreviewResponseSchema,
} from "@cce/api-contracts";
import { expect, test } from "@playwright/test";

test("provider deltas append through real HTTP routes to one conversation", async ({ request }) => {
  const token = process.env["CCE_E2E_API_TOKEN"] ?? process.env["CCE_SEED_API_TOKEN"];
  if (!token) throw new Error("A seeded CCE E2E API token is required.");
  const headers = { Authorization: `Bearer ${token}` };
  const created = await request.post("/api/projects", {
    headers,
    data: { name: `Provider delta ${randomUUID()}` },
  });
  expect(created.status()).toBe(201);
  const project = projectResponseSchema.parse(await created.json());
  const root = `/api/projects/${project.id}`;
  let previousImportId: string | undefined;
  let conversationId: string | undefined;
  for (const text of ["First evidence", "Additional evidence"]) {
    const previewResponse = await request.post(`${root}/imports/provider-previews`, {
      headers,
      data: {
        source: "codex",
        captureScope: "partial",
        previousImportId,
        messages: [{ role: "user", content: [{ type: "text", text }] }],
      },
    });
    expect(previewResponse.status()).toBe(201);
    const preview = providerConversationImportPreviewResponseSchema.parse(
      await previewResponse.json(),
    );
    expect(preview.operation).toBe(previousImportId ? "append" : "create");
    expect(preview.messageCount).toBe(1);
    if (conversationId) expect(preview.targetConversationId).toBe(conversationId);
    const submitResponse = await request.post(`${root}/imports/provider-submissions`, {
      headers,
      data: { previewId: preview.id },
    });
    expect(submitResponse.status()).toBe(201);
    const imported = conversationImportResponseSchema.parse(await submitResponse.json());
    expect(imported.messageCount).toBe(1);
    expect(imported.id).not.toBe(previousImportId);
    const target = imported.importedConversations[0]?.conversationId;
    if (!target) throw new Error("Import must return its Conversation ID.");
    if (conversationId) expect(target).toBe(conversationId);
    conversationId = target;
    previousImportId = imported.id;
    const replay = await request.post(`${root}/imports/provider-submissions`, {
      headers,
      data: { previewId: preview.id },
    });
    expect(replay.status()).toBe(201);
    expect(conversationImportResponseSchema.parse(await replay.json())).toEqual(imported);
  }
  const conversationsResponse = await request.get(`${root}/conversations`, { headers });
  expect(conversationsResponse.status()).toBe(200);
  expect(conversationListResponseSchema.parse(await conversationsResponse.json())).toHaveLength(1);
  const messagesResponse = await request.get(`${root}/conversations/${conversationId}/messages`, {
    headers,
  });
  expect(messagesResponse.status()).toBe(200);
  const messages = messageListResponseSchema.parse(await messagesResponse.json());
  expect(messages.map(({ sequence, content }) => [sequence, content])).toEqual([
    [1, "First evidence"],
    [2, "Additional evidence"],
  ]);
  const projectResponse = await request.get(root, { headers });
  expect(projectResponse.status()).toBe(200);
  expect(projectResponseSchema.parse(await projectResponse.json()).headCommitId).toBe(
    project.headCommitId,
  );
});
