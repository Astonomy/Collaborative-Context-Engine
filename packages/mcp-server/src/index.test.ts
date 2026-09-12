import { ConversationImportService, ProjectService } from "@cce/application";
import { contextCommitSchema, projectMemberSchema, projectSchema, userSchema } from "@cce/domain";
import { FixedClock, InMemoryUnitOfWork, SequenceIdGenerator } from "@cce/test-support";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

import { createCceMcpServer } from "./index";

function uuid(value: number): string {
  return `00000000-0000-4000-8000-${value.toString().padStart(12, "0")}`;
}

function idsFrom(start: number): SequenceIdGenerator {
  return new SequenceIdGenerator(Array.from({ length: 100 }, (_, index) => uuid(start + index)));
}

function firstText(content: unknown): string {
  const first = z
    .array(z.object({ type: z.literal("text"), text: z.string() }))
    .min(1)
    .parse(content)[0];
  if (first === undefined) throw new Error("Expected text content.");
  return first.text;
}

describe("CCE MCP server", () => {
  const clients: Client[] = [];

  afterEach(async () => {
    await Promise.all(clients.splice(0).map(async (client) => client.close()));
  });

  it("exposes truthful tools and executes preview-before-submit through application services", async () => {
    const unitOfWork = new InMemoryUnitOfWork();
    const clock = new FixedClock(new Date("2026-08-23T01:00:00.000Z"));
    const user = userSchema.parse({
      id: uuid(1),
      email: "alice@example.test",
      displayName: "Alice",
      createdAt: "2026-08-23T00:00:00.000Z",
    });
    const project = projectSchema.parse({
      id: uuid(2),
      name: "CCE",
      headCommitId: uuid(3),
      version: 0,
      createdBy: user.id,
      createdAt: "2026-08-23T00:00:00.000Z",
      archivedAt: null,
    });
    const member = projectMemberSchema.parse({
      projectId: project.id,
      userId: user.id,
      role: "editor",
      joinedAt: project.createdAt,
    });
    const genesis = contextCommitSchema.parse({
      id: project.headCommitId,
      projectId: project.id,
      kind: "genesis",
      parentCommitId: null,
      version: 0,
      idempotencyKey: `project-genesis:${project.id}`,
      summary: "Project genesis",
      sourceDeltaIds: [],
      proposedBy: [],
      committedBy: { type: "human", userId: user.id },
      changes: [],
      createdAt: project.createdAt,
    });
    unitOfWork.seedUser(user);
    unitOfWork.seedProject(project, member, genesis);

    const server = createCceMcpServer({
      actorUserId: user.id,
      projects: new ProjectService(unitOfWork, idsFrom(10), clock),
      conversationImports: new ConversationImportService(unitOfWork, idsFrom(100), clock),
    });
    const client = new Client({ name: "cce-mcp-test", version: "0.1.0" });
    clients.push(client);
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);

    const tools = await client.listTools();
    expect(tools.tools.map((tool) => tool.name)).toEqual([
      "list_projects",
      "preview_conversation_import",
      "submit_conversation_import",
    ]);
    expect(tools.tools.find((tool) => tool.name === "list_projects")?.annotations).toMatchObject({
      readOnlyHint: true,
      destructiveHint: false,
    });
    expect(
      tools.tools.find((tool) => tool.name === "submit_conversation_import")?.annotations,
    ).toMatchObject({ readOnlyHint: false, destructiveHint: false, idempotentHint: true });

    const listed = await client.callTool({ name: "list_projects", arguments: { name: "cce" } });
    expect(listed.structuredContent).toEqual({
      projects: [{ id: project.id, name: "CCE", role: "editor", archived: false }],
    });
    const captureArguments = {
      projectId: project.id,
      source: "codex",
      captureScope: "partial",
      title: "MCP capture",
      summary: "A bounded Codex capture with its supplied materials.",
      messages: [
        {
          role: "assistant",
          content: [{ type: "text", text: "A bounded conversation capture." }],
          metadata: {},
        },
      ],
      metadata: {},
    };
    const preview = await client.callTool({
      name: "preview_conversation_import",
      arguments: captureArguments,
    });
    expect(preview.isError).not.toBe(true);
    expect(preview.structuredContent).toMatchObject({
      source: "codex-plugin",
      targetProject: { id: project.id, name: project.name },
      summary: captureArguments.summary,
      messageCount: 1,
      duplicateStatus: "none",
    });
    expect(unitOfWork.view().conversations).toHaveLength(0);
    const { previewId } = z.object({ previewId: z.uuid() }).parse(preview.structuredContent);

    const submitted = await client.callTool({
      name: "submit_conversation_import",
      arguments: { projectId: project.id, previewId },
    });
    expect(submitted.isError).not.toBe(true);
    expect(submitted.structuredContent).toMatchObject({
      projectId: project.id,
      messageCount: 1,
    });
    expect(unitOfWork.view().messages).toHaveLength(1);
    expect(unitOfWork.view().projects[0]?.headCommitId).toBe(genesis.id);

    const duplicatePreview = await client.callTool({
      name: "preview_conversation_import",
      arguments: captureArguments,
    });
    const duplicatePreviewContent = z
      .object({
        previewId: z.uuid(),
        duplicateStatus: z.literal("duplicate"),
        duplicateConversationId: z.uuid(),
      })
      .parse(duplicatePreview.structuredContent);
    const duplicateSubmit = await client.callTool({
      name: "submit_conversation_import",
      arguments: { projectId: project.id, previewId: duplicatePreviewContent.previewId },
    });
    expect(duplicateSubmit.structuredContent).toMatchObject(
      z.object({ importId: z.uuid(), conversationId: z.uuid() }).parse(submitted.structuredContent),
    );
    expect(unitOfWork.view().conversations).toHaveLength(1);

    const unknownProject = await client.callTool({
      name: "preview_conversation_import",
      arguments: { ...captureArguments, projectId: uuid(999) },
    });
    expect(unknownProject).toMatchObject({ isError: true });
    expect(firstText(unknownProject.content)).toContain("NOT_FOUND");

    const malformed = await client.callTool({
      name: "preview_conversation_import",
      arguments: { ...captureArguments, messages: [] },
    });
    expect(malformed).toMatchObject({ isError: true });

    const confidentialValue = "cce-secret-that-must-not-be-reported";
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const confidentialMalformed = await client.callTool({
      name: "preview_conversation_import",
      arguments: {
        ...captureArguments,
        messages: [],
        metadata: { apiToken: confidentialValue },
      },
    });
    expect(JSON.stringify(confidentialMalformed)).not.toContain(confidentialValue);
    expect(errorLog).not.toHaveBeenCalled();
    errorLog.mockRestore();

    const oversized = await client.callTool({
      name: "preview_conversation_import",
      arguments: {
        ...captureArguments,
        messages: [
          {
            role: "assistant",
            content: [{ type: "text", text: "x".repeat(1_000_001) }],
            metadata: {},
          },
        ],
      },
    });
    expect(oversized).toMatchObject({ isError: true });
    expect(firstText(oversized.content)).toContain("VALIDATION");

    const expiring = await client.callTool({
      name: "preview_conversation_import",
      arguments: {
        ...captureArguments,
        messages: [
          {
            role: "assistant",
            content: [{ type: "text", text: "A capture that will expire." }],
            metadata: {},
          },
        ],
      },
    });
    const expiringContent = z
      .object({ previewId: z.uuid(), expiresAt: z.string().datetime() })
      .parse(expiring.structuredContent);
    clock.set(new Date(expiringContent.expiresAt));
    const expired = await client.callTool({
      name: "submit_conversation_import",
      arguments: { projectId: project.id, previewId: expiringContent.previewId },
    });
    expect(expired).toMatchObject({ isError: true });
    expect(firstText(expired.content)).toContain("CONFLICT");
  });
});
