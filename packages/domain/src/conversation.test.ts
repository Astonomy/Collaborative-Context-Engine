import { describe, expect, it } from "vitest";

import { branchSchema, messageSchema, assertBranchTransition, assertMessageTransition } from "./conversation";

const ids = {
  project: "00000000-0000-4000-8000-000000000001",
  branch: "00000000-0000-4000-8000-000000000002",
  conversation: "00000000-0000-4000-8000-000000000003",
  commit: "00000000-0000-4000-8000-000000000004",
  message: "00000000-0000-4000-8000-000000000005",
  user: "00000000-0000-4000-8000-000000000006",
  clientMessage: "00000000-0000-4000-8000-000000000007",
} as const;

describe("Conversation evidence invariants", () => {
  it("requires closed branches to record their close time", () => {
    const result = branchSchema.safeParse({
      id: ids.branch,
      projectId: ids.project,
      conversationId: ids.conversation,
      baseCommitId: ids.commit,
      status: "merged",
      createdAt: "2026-08-23T00:00:00.000Z",
      closedAt: null,
    });
    expect(result.success).toBe(false);
  });

  it("allows only open branches to transition to a terminal state", () => {
    expect(() => assertBranchTransition("open", "merged")).not.toThrow();
    expect(() => assertBranchTransition("merged", "abandoned")).toThrow(
      "cannot transition",
    );
    expect(() => assertBranchTransition("open", "open")).toThrow("cannot transition");
  });

  it("requires user idempotency IDs and completed content", () => {
    const base = {
      id: ids.message,
      projectId: ids.project,
      conversationId: ids.conversation,
      sequence: 1,
      clientMessageId: null,
      role: "user",
      deliveryState: "completed",
      content: "",
      author: { type: "human", userId: ids.user },
      providerMessageId: null,
      errorCode: null,
      createdAt: "2026-08-23T00:00:00.000Z",
      completedAt: "2026-08-23T00:00:01.000Z",
    };
    const result = messageSchema.safeParse(base);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.map((issue) => issue.message)).toEqual(
        expect.arrayContaining([
          "A completed message must contain content.",
          "A user message requires a clientMessageId for idempotency.",
        ]),
      );
    }
  });

  it("requires terminal state and completion time to agree", () => {
    const result = messageSchema.safeParse({
      id: ids.message,
      projectId: ids.project,
      conversationId: ids.conversation,
      sequence: 1,
      clientMessageId: ids.clientMessage,
      role: "user",
      deliveryState: "pending",
      content: "hello",
      author: { type: "human", userId: ids.user },
      providerMessageId: null,
      errorCode: null,
      createdAt: "2026-08-23T00:00:00.000Z",
      completedAt: "2026-08-23T00:00:01.000Z",
    });
    expect(result.success).toBe(false);
  });

  it("prevents changing immutable terminal messages", () => {
    expect(() => assertMessageTransition("pending", "streaming")).not.toThrow();
    expect(() => assertMessageTransition("streaming", "interrupted")).not.toThrow();
    expect(() => assertMessageTransition("completed", "streaming")).toThrow(
      "cannot transition",
    );
  });
});

