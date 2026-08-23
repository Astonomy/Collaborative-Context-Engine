// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";

import { conversationSchema, type Conversation } from "@cce/domain";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ConversationPanel } from "./conversation-panel";

afterEach(cleanup);

const conversation = conversationSchema.parse({
  id: "00000000-0000-4000-8000-000000000001",
  projectId: "00000000-0000-4000-8000-000000000002",
  branchId: "00000000-0000-4000-8000-000000000003",
  title: "Architecture",
  status: "active",
  createdBy: { type: "human", userId: "00000000-0000-4000-8000-000000000004" },
  createdAt: "2026-08-23T00:00:00.000Z",
  archivedAt: null,
});

function renderPanel(
  role: "owner" | "editor" | "viewer",
  projectArchived: boolean,
  onUpdateConversation: (
    conversationId: Conversation["id"],
    update: { readonly title?: string; readonly archive?: true },
  ) => Promise<void>,
): void {
  render(
    <ConversationPanel
      conversations={[conversation]}
      selectedConversationId={conversation.id}
      messages={[]}
      streamingText={null}
      lastDelta={null}
      agentResult={null}
      role={role}
      projectArchived={projectArchived}
      busy={false}
      onCreateConversation={() => Promise.resolve()}
      onSelectConversation={() => undefined}
      onUpdateConversation={onUpdateConversation}
      onChat={() => Promise.resolve()}
      onExtract={() => Promise.resolve()}
      onCreateMerge={() => Promise.resolve()}
      onRunAgent={() => Promise.resolve()}
      onResumeAgent={() => Promise.resolve()}
    />,
  );
}

describe("ConversationPanel lifecycle controls", () => {
  it("lets an Editor rename and archive an active Conversation", async () => {
    const user = userEvent.setup();
    const onUpdate = vi.fn<
      (
        conversationId: Conversation["id"],
        update: { readonly title?: string; readonly archive?: true },
      ) => Promise<void>
    >().mockResolvedValue();
    renderPanel("editor", false, onUpdate);

    const title = screen.getByLabelText("Conversation title");
    await user.clear(title);
    await user.type(title, "Architecture decisions");
    await user.click(screen.getByRole("button", { name: "Rename" }));
    expect(onUpdate).toHaveBeenCalledWith(conversation.id, {
      title: "Architecture decisions",
    });

    await user.click(screen.getByRole("button", { name: "Archive conversation" }));
    expect(onUpdate).toHaveBeenCalledWith(conversation.id, { archive: true });
  });

  it("disables all mutation controls for a Viewer or archived Project", () => {
    const { rerender } = render(
      <ConversationPanel
        conversations={[conversation]}
        selectedConversationId={conversation.id}
        messages={[]}
        streamingText={null}
        lastDelta={null}
        agentResult={null}
        role="viewer"
        projectArchived={false}
        busy={false}
        onCreateConversation={() => Promise.resolve()}
        onSelectConversation={() => undefined}
        onUpdateConversation={() => Promise.resolve()}
        onChat={() => Promise.resolve()}
        onExtract={() => Promise.resolve()}
        onCreateMerge={() => Promise.resolve()}
        onRunAgent={() => Promise.resolve()}
        onResumeAgent={() => Promise.resolve()}
      />,
    );
    expect(screen.getByRole("button", { name: "Archive conversation" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Create conversation" })).toBeDisabled();

    rerender(
      <ConversationPanel
        conversations={[conversation]}
        selectedConversationId={conversation.id}
        messages={[]}
        streamingText={null}
        lastDelta={null}
        agentResult={null}
        role="owner"
        projectArchived
        busy={false}
        onCreateConversation={() => Promise.resolve()}
        onSelectConversation={() => undefined}
        onUpdateConversation={() => Promise.resolve()}
        onChat={() => Promise.resolve()}
        onExtract={() => Promise.resolve()}
        onCreateMerge={() => Promise.resolve()}
        onRunAgent={() => Promise.resolve()}
        onResumeAgent={() => Promise.resolve()}
      />,
    );
    expect(screen.getByRole("button", { name: "Archive conversation" })).toBeDisabled();
    expect(screen.getByText("Archived projects are read-only.")).toBeInTheDocument();
  });
});
