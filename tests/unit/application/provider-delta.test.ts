import { ConversationImportService, type UnitOfWork } from "@cce/application";
import { projectIdSchema, userIdSchema } from "@cce/domain";
import { describe, expect, it } from "vitest";
import { createFixture, idsFrom, uuid } from "./fixtures";

function capture(text: string, previousImportId?: string) {
  return {
    source: "codex" as const,
    captureScope: "partial" as const,
    ...(previousImportId ? { previousImportId } : {}),
    title: "Plugin conversation",
    messages: [{ role: "user" as const, content: [{ type: "text" as const, text }], metadata: {} }],
    metadata: {},
  };
}

async function setup() {
  const fixture = createFixture();
  const service = new ConversationImportService(fixture.unitOfWork, idsFrom(100), fixture.clock);
  const scope = { projectId: fixture.project.id, actorUserId: fixture.user.id };
  const preview = await service.previewProviderSubmission({
    ...scope,
    submission: capture("First"),
  });
  const first = await service.submitProviderPreview({ ...scope, previewId: preview.id });
  return { ...fixture, service, scope, first };
}

describe("provider conversation deltas", () => {
  it("appends successive deltas to the existing conversation and preserves old evidence", async () => {
    const { service, scope, first, unitOfWork, genesis } = await setup();
    const original = structuredClone(unitOfWork.view());
    let previous = first;
    for (const text of ["Second", "Third"]) {
      const preview = await service.previewProviderSubmission({
        ...scope,
        submission: capture(text, previous.id),
      });
      expect(preview).toMatchObject({
        operation: "append",
        targetConversationId: first.importedConversations[0]?.conversationId,
        messageCount: 1,
      });
      previous = await service.submitProviderPreview({ ...scope, previewId: preview.id });
      expect(previous.importedConversations[0]?.conversationId).toBe(
        first.importedConversations[0]?.conversationId,
      );
      expect(previous.messageCount).toBe(1);
    }
    const state = unitOfWork.view();
    expect(state.conversations).toEqual(original.conversations);
    expect(state.branches).toEqual(original.branches);
    expect(state.messages.map(({ sequence, content }) => [sequence, content])).toEqual([
      [1, "First"],
      [2, "Second"],
      [3, "Third"],
    ]);
    expect(state.messages[0]).toEqual(original.messages[0]);
    expect(state.imports[0]).toEqual(first);
    expect(state.imports[1]?.sourceManifest[0]?.previousImportId).toBe(first.id);
    expect(state.auditEvents).toHaveLength(3);
    expect(state.commits).toEqual([genesis]);
    expect(state.projects[0]?.headCommitId).toBe(genesis.id);
  });

  it("replays an identical delta and rejects a different delta using a stale predecessor", async () => {
    const { service, scope, first, unitOfWork } = await setup();
    const input = { ...scope, submission: capture("Second", first.id) };
    const preview = await service.previewProviderSubmission(input);
    const competing = await service.previewProviderSubmission({
      ...scope,
      submission: capture("Different delta", first.id),
    });
    const second = await service.submitProviderPreview({ ...scope, previewId: preview.id });
    expect(await service.submitProviderPreview({ ...scope, previewId: preview.id })).toEqual(
      second,
    );
    const retry = await service.previewProviderSubmission(input);
    expect(retry).toMatchObject({ duplicateStatus: "duplicate", duplicateImportId: second.id });
    expect(await service.submitProviderPreview({ ...scope, previewId: retry.id })).toEqual(second);
    await expect(
      service.submitProviderPreview({ ...scope, previewId: competing.id }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    await expect(
      service.previewProviderSubmission({
        ...scope,
        submission: capture("Different delta", first.id),
      }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    expect(unitOfWork.view().messages).toHaveLength(2);
    expect(unitOfWork.view().conversations).toHaveLength(1);
    expect(unitOfWork.view().imports).toHaveLength(2);
  });

  it("does not infer continuation from title or similar text", async () => {
    const { service, scope, unitOfWork } = await setup();
    const preview = await service.previewProviderSubmission({
      ...scope,
      submission: capture("Second"),
    });
    expect(preview).toMatchObject({ operation: "create" });
    await service.submitProviderPreview({ ...scope, previewId: preview.id });
    expect(unitOfWork.view().conversations).toHaveLength(2);
  });

  it("retains delta material references and rejects a changed provider conversation ID", async () => {
    const { service, scope, first } = await setup();
    const reference = {
      type: "file_reference" as const,
      reference: "provider://original.pdf",
      metadata: { mediaType: "application/pdf" },
    };
    const preview = await service.previewProviderSubmission({
      ...scope,
      submission: {
        ...capture("Second", first.id),
        externalConversationId: "real-provider-conversation",
        messages: [
          {
            role: "user",
            content: [{ type: "text", text: "See the original." }, reference],
            metadata: {},
          },
        ],
      },
    });
    expect(preview.unsupportedContentCount).toBe(1);
    const appended = await service.submitProviderPreview({ ...scope, previewId: preview.id });
    expect(appended.sourceManifest[0]?.nodes[0]?.content[1]).toEqual(reference);
    const nextPreview = await service.previewProviderSubmission({
      ...scope,
      submission: capture("Third", appended.id),
    });
    const next = await service.submitProviderPreview({ ...scope, previewId: nextPreview.id });
    expect(next.importedConversations[0]?.externalConversationId).toBe(
      "real-provider-conversation",
    );
    await expect(
      service.previewProviderSubmission({
        ...scope,
        submission: {
          ...capture("Fourth", next.id),
          externalConversationId: "different-provider-conversation",
        },
      }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("rejects missing, cross-project, other-actor, and other-provider predecessors", async () => {
    const { service, scope, first, unitOfWork, user, project, member, genesis } = await setup();
    await expect(
      service.previewProviderSubmission({
        ...scope,
        submission: capture("Second", uuid(999)),
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    const otherProject = { ...project, id: projectIdSchema.parse(uuid(8)) };
    unitOfWork.seedProject(
      otherProject,
      { ...member, projectId: otherProject.id },
      {
        ...genesis,
        projectId: otherProject.id,
      },
    );
    await expect(
      service.previewProviderSubmission({
        ...scope,
        projectId: otherProject.id,
        submission: capture("Second", first.id),
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    const otherUser = { ...user, id: userIdSchema.parse(uuid(9)), email: "other@example.test" };
    unitOfWork.seedUser(otherUser);
    await unitOfWork.run((repositories) =>
      repositories.projects.insertMember({
        ...member,
        userId: otherUser.id,
      }),
    );
    await expect(
      service.previewProviderSubmission({
        ...scope,
        actorUserId: otherUser.id,
        submission: capture("Second", first.id),
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(
      service.previewProviderSubmission({
        ...scope,
        submission: { ...capture("Second", first.id), source: "chatgpt" },
      }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    expect(unitOfWork.view().messages).toHaveLength(1);
  });

  it("rechecks archive state and rolls back failed delta writes", async () => {
    const { service, scope, first, unitOfWork, clock } = await setup();
    const preview = await service.previewProviderSubmission({
      ...scope,
      submission: capture("Second", first.id),
    });
    const before = structuredClone(unitOfWork.view());
    const failing: UnitOfWork = {
      run: (operation) =>
        unitOfWork.run((repositories) =>
          operation({
            ...repositories,
            audit: {
              ...repositories.audit,
              append: async () => {
                throw new Error("audit failed");
              },
            },
          }),
        ),
    };
    const failingService = new ConversationImportService(failing, idsFrom(300), clock);
    await expect(
      failingService.submitProviderPreview({ ...scope, previewId: preview.id }),
    ).rejects.toThrow("audit failed");
    expect(unitOfWork.view()).toEqual(before);
    const conversation = unitOfWork.view().conversations[0];
    const branch = unitOfWork.view().branches[0];
    if (!conversation || !branch) throw new Error("Expected initial imported conversation.");
    await unitOfWork.run((repositories) =>
      repositories.conversations.update(
        {
          ...conversation,
          status: "archived",
          archivedAt: clock.now().toISOString(),
        },
        branch,
      ),
    );
    await expect(
      service.submitProviderPreview({ ...scope, previewId: preview.id }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    expect(unitOfWork.view().messages).toHaveLength(1);
  });
});
