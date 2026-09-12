import { ConversationImportService, type UnitOfWork } from "@cce/application";
import { describe, expect, it } from "vitest";
import { createFixture, idsFrom } from "./fixtures";

const source = new TextEncoder().encode(
  JSON.stringify([
    {
      id: "external-1",
      title: "Imported",
      current_node: "a",
      mapping: {
        u: {
          id: "u",
          parent: null,
          message: {
            id: "u",
            author: { role: "human" },
            content: { content_type: "text", parts: ["evidence"] },
          },
        },
        a: {
          id: "a",
          parent: "u",
          message: {
            id: "a",
            author: { role: "assistant" },
            content: { content_type: "text", parts: ["response"] },
          },
        },
      },
    },
  ]),
);

describe("ConversationImportService", () => {
  it("previews, imports selected evidence, retains provenance, audits, and is idempotent", async () => {
    const fixture = createFixture("editor");
    const service = new ConversationImportService(fixture.unitOfWork, idsFrom(100), fixture.clock);
    const preview = await service.preview({
      projectId: fixture.project.id,
      actorUserId: fixture.user.id,
      fileName: "conversations.json",
      bytes: source,
    });
    expect(preview.conversations).toMatchObject([{ selectionId: "external-1", messageCount: 2 }]);
    const input = {
      projectId: fixture.project.id,
      actorUserId: fixture.user.id,
      fileName: "conversations.json",
      bytes: source,
      selectedConversationIds: ["external-1"],
    };
    const first = await service.confirm(input);
    const replay = await service.confirm(input);
    expect(replay.id).toBe(first.id);
    expect(fixture.unitOfWork.view().messages).toHaveLength(2);
    expect(first.sourceManifest[0]?.externalConversationId).toBe("external-1");
    expect(fixture.unitOfWork.view().auditEvents).toMatchObject([
      { action: "conversation_import.completed" },
    ]);
    expect(fixture.project.headCommitId).toBe(fixture.unitOfWork.view().projects[0]?.headCommitId);
  });
  it("denies viewers without persisting partial evidence", async () => {
    const fixture = createFixture("viewer");
    const service = new ConversationImportService(fixture.unitOfWork, idsFrom(100), fixture.clock);
    await expect(
      service.preview({
        projectId: fixture.project.id,
        actorUserId: fixture.user.id,
        fileName: "conversations.json",
        bytes: source,
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(fixture.unitOfWork.view().conversations).toEqual([]);
  });
  it("rejects selections not belonging to the uploaded file", async () => {
    const fixture = createFixture();
    const service = new ConversationImportService(fixture.unitOfWork, idsFrom(100), fixture.clock);
    await expect(
      service.confirm({
        projectId: fixture.project.id,
        actorUserId: fixture.user.id,
        fileName: "conversations.json",
        bytes: source,
        selectedConversationIds: ["other"],
      }),
    ).rejects.toMatchObject({ code: "VALIDATION" });
  });

  it("previews provider evidence without importing, then persists provenance without changing context", async () => {
    const fixture = createFixture("editor");
    const service = new ConversationImportService(fixture.unitOfWork, idsFrom(100), fixture.clock);
    const preview = await service.previewProviderSubmission({
      projectId: fixture.project.id,
      actorUserId: fixture.user.id,
      submission: {
        source: "chatgpt",
        captureScope: "partial",
        externalConversationId: "chatgpt-conversation-1",
        title: "Imported through the plugin",
        summary: "The conversation and attached image establish PostgreSQL as authoritative.",
        messages: [
          {
            externalMessageId: "user-1",
            role: "user",
            content: [{ type: "text", text: "Please record this decision." }],
            metadata: {},
          },
          {
            externalMessageId: "assistant-1",
            role: "assistant",
            content: [
              { type: "text", text: "PostgreSQL is the source of truth." },
              { type: "image_reference", reference: "provider-image", metadata: {} },
            ],
            metadata: {},
          },
        ],
        metadata: { provider: "chatgpt" },
      },
    });

    expect(preview).toMatchObject({
      source: "chatgpt-plugin",
      targetProject: { id: fixture.project.id, name: fixture.project.name },
      summary: "The conversation and attached image establish PostgreSQL as authoritative.",
      messageCount: 2,
      unsupportedContentCount: 1,
      duplicateStatus: "none",
    });
    expect(fixture.unitOfWork.view()).toMatchObject({
      conversations: [],
      messages: [],
      imports: [],
    });
    expect(fixture.unitOfWork.view().importPreviews).toHaveLength(1);

    const imported = await service.submitProviderPreview({
      projectId: fixture.project.id,
      actorUserId: fixture.user.id,
      previewId: preview.id,
    });
    const state = fixture.unitOfWork.view();
    expect(imported).toMatchObject({
      source: "chatgpt-plugin",
      sourceFormat: "mcp",
      policy: "provided_messages",
      conversationCount: 1,
      messageCount: 2,
    });
    expect(imported.sourceManifest[0]?.metadata).toMatchObject({
      importedBy: fixture.user.id,
      previewId: preview.id,
      provider: "chatgpt",
    });
    expect(imported.sourceManifest[0]?.summary).toBe(preview.summary);
    expect(imported.sourceManifest[0]?.nodes[1]?.content[1]).toEqual({
      type: "image_reference",
      reference: "provider-image",
      metadata: {},
    });
    expect(state.messages.map((message) => message.providerMessageId)).toEqual([
      "user-1",
      "assistant-1",
    ]);
    expect(state.messages.every((message) => message.author.type === "policy")).toBe(true);
    expect(state.auditEvents).toMatchObject([
      {
        actor: { type: "human", userId: fixture.user.id },
        action: "conversation_import.completed",
      },
    ]);
    expect(state.projects[0]?.headCommitId).toBe(fixture.genesis.id);
    expect(state.commits).toHaveLength(1);
    expect(state.projection.size).toBe(0);
  });

  it("requires the previewing actor, rejects expiry, and leaves no partial evidence", async () => {
    const fixture = createFixture("editor");
    const service = new ConversationImportService(fixture.unitOfWork, idsFrom(100), fixture.clock);
    const preview = await service.previewProviderSubmission({
      projectId: fixture.project.id,
      actorUserId: fixture.user.id,
      submission: {
        source: "codex",
        captureScope: "full",
        messages: [
          { role: "assistant", content: [{ type: "text", text: "Evidence" }], metadata: {} },
        ],
        metadata: {},
      },
    });

    fixture.clock.set(new Date(preview.expiresAt));
    await expect(
      service.submitProviderPreview({
        projectId: fixture.project.id,
        actorUserId: fixture.user.id,
        previewId: preview.id,
      }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    expect(fixture.unitOfWork.view().conversations).toEqual([]);
    expect(fixture.unitOfWork.view().messages).toEqual([]);
    expect(fixture.unitOfWork.view().auditEvents).toEqual([]);
  });

  it("denies provider preview to viewers and normalizes parser failures as validation errors", async () => {
    const fixture = createFixture("viewer");
    const service = new ConversationImportService(fixture.unitOfWork, idsFrom(100), fixture.clock);
    const input = {
      projectId: fixture.project.id,
      actorUserId: fixture.user.id,
      submission: {
        source: "codex" as const,
        captureScope: "full" as const,
        messages: [
          {
            role: "assistant" as const,
            content: [{ type: "text" as const, text: "Evidence" }],
            metadata: {},
          },
        ],
        metadata: {},
      },
    };
    await expect(service.previewProviderSubmission(input)).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    expect(fixture.unitOfWork.view().importPreviews).toEqual([]);

    const ownerFixture = createFixture();
    const ownerService = new ConversationImportService(
      ownerFixture.unitOfWork,
      idsFrom(100),
      ownerFixture.clock,
    );
    await expect(
      ownerService.previewProviderSubmission({
        projectId: ownerFixture.project.id,
        actorUserId: ownerFixture.user.id,
        submission: { ...input.submission, messages: [] },
      }),
    ).rejects.toMatchObject({ code: "VALIDATION", details: { importCode: "MALFORMED" } });
    expect(ownerFixture.unitOfWork.view().importPreviews).toEqual([]);
  });

  it("deduplicates an approved provider capture within one project", async () => {
    const fixture = createFixture();
    const service = new ConversationImportService(fixture.unitOfWork, idsFrom(100), fixture.clock);
    const input = {
      projectId: fixture.project.id,
      actorUserId: fixture.user.id,
      submission: {
        source: "codex" as const,
        captureScope: "full" as const,
        messages: [
          {
            role: "assistant" as const,
            content: [{ type: "text" as const, text: "Evidence" }],
            metadata: {},
          },
        ],
        metadata: {},
      },
    };
    const firstPreview = await service.previewProviderSubmission(input);
    const first = await service.submitProviderPreview({
      projectId: fixture.project.id,
      actorUserId: fixture.user.id,
      previewId: firstPreview.id,
    });
    const duplicatePreview = await service.previewProviderSubmission(input);
    expect(duplicatePreview).toMatchObject({
      duplicateStatus: "duplicate",
      duplicateImportId: first.id,
      duplicateConversationId: first.importedConversations[0]?.conversationId,
    });
    const replay = await service.submitProviderPreview({
      projectId: fixture.project.id,
      actorUserId: fixture.user.id,
      previewId: duplicatePreview.id,
    });
    expect(replay.id).toBe(first.id);
    expect(fixture.unitOfWork.view().conversations).toHaveLength(1);
    expect(fixture.unitOfWork.view().messages).toHaveLength(1);
  });

  it("rolls back Conversation, Message, manifest, and audit writes when submit fails", async () => {
    const fixture = createFixture();
    const failingUnitOfWork: UnitOfWork = {
      run: (operation) =>
        fixture.unitOfWork.run((repositories) =>
          operation({
            ...repositories,
            audit: {
              ...repositories.audit,
              append: async () => {
                throw new Error("forced audit failure");
              },
            },
          }),
        ),
    };
    const service = new ConversationImportService(failingUnitOfWork, idsFrom(100), fixture.clock);
    const preview = await service.previewProviderSubmission({
      projectId: fixture.project.id,
      actorUserId: fixture.user.id,
      submission: {
        source: "codex",
        captureScope: "full",
        messages: [
          { role: "assistant", content: [{ type: "text", text: "Evidence" }], metadata: {} },
        ],
        metadata: {},
      },
    });

    await expect(
      service.submitProviderPreview({
        projectId: fixture.project.id,
        actorUserId: fixture.user.id,
        previewId: preview.id,
      }),
    ).rejects.toThrow("forced audit failure");
    expect(fixture.unitOfWork.view()).toMatchObject({
      conversations: [],
      branches: [],
      messages: [],
      imports: [],
      auditEvents: [],
    });
  });
});
