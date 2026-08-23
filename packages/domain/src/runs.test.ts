import { describe, expect, it } from "vitest";

import { modelRunSchema } from "./runs";

const running = {
  id: "00000000-0000-4000-8000-000000000001",
  projectId: "00000000-0000-4000-8000-000000000002",
  conversationId: null,
  provider: "pending",
  model: "medium",
  purpose: "chat",
  promptId: "chat",
  promptVersion: 1,
  inputHash: "a".repeat(64),
  status: "running",
  inputTokens: null,
  cachedTokens: null,
  outputTokens: null,
  latencyMs: null,
  errorCode: null,
  createdAt: "2026-08-23T00:00:00.000Z",
  completedAt: null,
} as const;

describe("ModelRun invariants", () => {
  it("accepts running and fully populated completed states", () => {
    expect(modelRunSchema.safeParse(running).success).toBe(true);
    expect(
      modelRunSchema.safeParse({
        ...running,
        provider: "test-provider",
        model: "test-model",
        status: "completed",
        inputTokens: 10,
        cachedTokens: 2,
        outputTokens: 3,
        latencyMs: 25,
        completedAt: "2026-08-23T00:00:01.000Z",
      }).success,
    ).toBe(true);
  });

  it.each([
    { ...running, completedAt: "2026-08-23T00:00:01.000Z" },
    { ...running, status: "completed", completedAt: "2026-08-23T00:00:01.000Z" },
    {
      ...running,
      status: "completed",
      inputTokens: 1,
      cachedTokens: 0,
      outputTokens: 1,
      latencyMs: 1,
      completedAt: "2026-08-23T00:00:01.000Z",
    },
    {
      ...running,
      status: "failed",
      latencyMs: 1,
      completedAt: "2026-08-23T00:00:01.000Z",
    },
    {
      ...running,
      status: "completed",
      inputTokens: 1,
      cachedTokens: 2,
      outputTokens: 1,
      latencyMs: 1,
      completedAt: "2026-08-23T00:00:01.000Z",
    },
  ])("rejects an invalid persistent state", (candidate) => {
    expect(modelRunSchema.safeParse(candidate).success).toBe(false);
  });
});
