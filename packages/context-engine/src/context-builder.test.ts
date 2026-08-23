import {
  contextItemVersionSchema,
  messageSchema,
  projectIdSchema,
  contextCommitIdSchema,
  type ContextItemVersion,
  type Message,
} from "@cce/domain";
import { describe, expect, it } from "vitest";

import { buildContextPack } from "./context-builder";
import { routeContext } from "./context-router";

const projectId = projectIdSchema.parse("20000000-0000-4000-8000-000000000001");
const headCommitId = contextCommitIdSchema.parse("20000000-0000-4000-8000-000000000002");

function version(
  sequence: number,
  kind: ContextItemVersion["kind"],
  key: string,
  options: {
    readonly authority?: ContextItemVersion["authority"];
    readonly lifecycle?: ContextItemVersion["lifecycle"];
  } = {},
): ContextItemVersion {
  const suffix = sequence.toString().padStart(12, "0");
  return contextItemVersionSchema.parse({
    id: `20000000-0000-4000-8000-${suffix}`,
    logicalItemId: `21000000-0000-4000-8000-${suffix}`,
    projectId,
    commitId: headCommitId,
    previousVersionId: null,
    kind,
    key,
    value: key,
    scope: { tags: [] },
    authority: options.authority ?? "authoritative",
    confidence: 1,
    provenance: [
      {
        projectId,
        conversationId: "20000000-0000-4000-8000-000000000100",
        messageIds: ["20000000-0000-4000-8000-000000000101"],
        actor: { type: "human", userId: "20000000-0000-4000-8000-000000000102" },
        modelRunId: null,
        recordedAt: "2026-08-23T00:00:00.000Z",
      },
    ],
    lifecycle: options.lifecycle ?? "active",
    scopeHash: "d".repeat(64),
    supersedesVersionId: null,
    createdAt: "2026-08-23T00:00:00.000Z",
  });
}

function message(sequence: number, content: string, state: Message["deliveryState"]): Message {
  const suffix = sequence.toString().padStart(12, "0");
  return messageSchema.parse({
    id: `22000000-0000-4000-8000-${suffix}`,
    projectId,
    conversationId: "20000000-0000-4000-8000-000000000100",
    sequence,
    clientMessageId: `23000000-0000-4000-8000-${suffix}`,
    role: "user",
    deliveryState: state,
    content,
    author: { type: "human", userId: "20000000-0000-4000-8000-000000000102" },
    providerMessageId: null,
    errorCode: null,
    createdAt: "2026-08-23T00:00:00.000Z",
    completedAt: state === "completed" ? "2026-08-23T00:00:01.000Z" : null,
  });
}

describe("ContextBuilder and ContextRouter", () => {
  it("builds a stable typed ContextPack from active authoritative state", () => {
    const pack = buildContextPack({
      project: { id: projectId, name: "CCE", headCommitId, version: 3 },
      items: [
        version(3, "decision", "z.last"),
        version(1, "decision", "a.first"),
        version(2, "requirement", "api.rest"),
        version(4, "fact", "old.fact", { lifecycle: "deprecated" }),
        version(5, "decision", "database.alternative", { authority: "alternative" }),
      ],
      messages: [
        message(1, "first", "completed"),
        message(2, "ignored pending", "pending"),
        message(3, "latest", "completed"),
      ],
      maxRecentMessages: 2,
      recentMessageCharacterBudget: 100,
    });

    expect(pack.decisions.map((entry) => entry.key)).toEqual(["a.first", "z.last"]);
    expect(pack.requirements.map((entry) => entry.key)).toEqual(["api.rest"]);
    expect(pack.facts).toEqual([]);
    expect(pack.alternatives.map((entry) => entry.key)).toEqual(["database.alternative"]);
    expect(pack.recentMessages.map((entry) => entry.sequence)).toEqual([1, 3]);
  });

  it("respects the recent-message count and character budget", () => {
    const pack = buildContextPack({
      project: { id: projectId, name: "CCE", headCommitId, version: 3 },
      items: [],
      messages: [message(1, "older", "completed"), message(2, "1234567890", "completed")],
      maxRecentMessages: 10,
      recentMessageCharacterBudget: 10,
    });
    expect(pack.recentMessages.map((entry) => entry.sequence)).toEqual([2]);
  });

  it("truncates an oversized newest message to the hard prompt budget", () => {
    const pack = buildContextPack({
      project: { id: projectId, name: "CCE", headCommitId, version: 3 },
      items: [],
      messages: [message(1, "older", "completed"), message(2, "0123456789", "completed")],
      maxRecentMessages: 10,
      recentMessageCharacterBudget: 4,
    });
    expect(pack.recentMessages).toHaveLength(1);
    expect(pack.recentMessages[0]).toMatchObject({ sequence: 2, content: "0123" });
  });

  it("rejects invalid selection budgets", () => {
    const base = {
      project: { id: projectId, name: "CCE", headCommitId, version: 3 },
      items: [],
      messages: [],
      maxRecentMessages: 1,
      recentMessageCharacterBudget: 1,
    };
    expect(() => buildContextPack({ ...base, maxRecentMessages: -1 })).toThrow(RangeError);
    expect(() =>
      buildContextPack({ ...base, recentMessageCharacterBudget: Number.NaN }),
    ).toThrow(RangeError);
  });

  it("refuses an unbounded active Context projection", () => {
    const item = version(1, "fact", "bounded.item");
    expect(() =>
      buildContextPack({
        project: { id: projectId, name: "CCE", headCommitId, version: 3 },
        items: Array.from({ length: 2_001 }, () => item),
        messages: [],
        maxRecentMessages: 1,
        recentMessageCharacterBudget: 1,
      }),
    ).toThrow("item budget");
  });

  it("routes only the context sections needed by specialist roles", () => {
    const pack = buildContextPack({
      project: { id: projectId, name: "CCE", headCommitId, version: 3 },
      items: [
        version(1, "architecture", "architecture.web"),
        version(2, "task", "task.release"),
        version(3, "risk", "risk.latency"),
      ],
      messages: [message(1, "hello", "completed")],
      maxRecentMessages: 10,
      recentMessageCharacterBudget: 100,
    });
    expect(routeContext(pack, "coding").architecture).toHaveLength(1);
    expect(routeContext(pack, "coding").risks).toEqual([]);
    expect(routeContext(pack, "research").tasks).toEqual([]);
    expect(routeContext(pack, "conflict").recentMessages).toEqual([]);
    expect(routeContext(pack, "extraction").alternatives).toEqual([]);
    expect(routeContext(pack, "chat").route).toBe("chat");
    expect(routeContext(pack, "manager").tasks).toHaveLength(1);
  });
});
