import { ExtractionService, type ModelResponse } from "@cce/application";
import { branchSchema, conversationSchema, messageSchema, type Message } from "@cce/domain";
import type { JsonValue } from "@cce/shared";
import { ScriptedModelProvider } from "@cce/test-support";
import { describe, expect, it } from "vitest";

import { createFixture, idsFrom, uuid } from "./fixtures";

function arrange() {
  const fixture = createFixture();
  const provider = new ScriptedModelProvider();
  const service = new ExtractionService(
    fixture.unitOfWork,
    provider,
    idsFrom(10_000),
    fixture.clock,
    fixture.hasher,
  );
  return { ...fixture, provider, service };
}

function seedWorkUnit(fixture: ReturnType<typeof arrange>, texts: readonly string[], start = 100) {
  const createdAt = fixture.clock.now().toISOString();
  const conversation = conversationSchema.parse({
    id: uuid(start),
    projectId: fixture.project.id,
    branchId: uuid(start + 1),
    title: "Database, model runtime, and authentication",
    status: "active",
    createdBy: { type: "human", userId: fixture.user.id },
    createdAt,
    archivedAt: null,
  });
  const branch = branchSchema.parse({
    id: conversation.branchId,
    projectId: fixture.project.id,
    conversationId: conversation.id,
    baseCommitId: fixture.project.headCommitId,
    status: "open",
    createdAt,
    closedAt: null,
  });
  const messages = texts.map((content, index) =>
    messageSchema.parse({
      id: uuid(start + 2 + index),
      projectId: fixture.project.id,
      conversationId: conversation.id,
      sequence: index + 1,
      clientMessageId: index % 2 === 0 ? uuid(start + 2 + index) : null,
      role: index % 2 === 0 ? "user" : "assistant",
      deliveryState: "completed",
      content,
      author:
        index % 2 === 0
          ? conversation.createdBy
          : { type: "model", provider: "test-provider", model: "test-model", runId: uuid(9_000) },
      providerMessageId: null,
      errorCode: null,
      createdAt,
      completedAt: createdAt,
    }),
  );
  fixture.unitOfWork.seedConversation(conversation, branch, [...messages].reverse());
  return {
    conversation,
    messages,
    input: {
      projectId: fixture.project.id,
      conversationId: conversation.id,
      actorUserId: fixture.user.id,
    },
  };
}

function mergedChange(messages: readonly Message[], value: JsonValue) {
  return {
    operation: "add",
    proposal: {
      kind: "decision",
      key: "conversation.work-unit",
      value,
      scope: { tags: [] },
      confidence: 0.98,
      evidenceMessageIds: messages.map((message) => message.id),
    },
  };
}

function response(changes: readonly unknown[]): ModelResponse {
  return {
    providerResponseId: "aggregation-response",
    provider: "test-provider",
    model: "test-model",
    content: JSON.stringify({ changes }),
    finishReason: "stop",
    usage: { inputTokens: 100, cachedTokens: 0, outputTokens: 50 },
  };
}

describe("conversation-level extraction", () => {
  it.each([
    {
      scenario: "multiple messages and related topics",
      texts: [
        "Use native WSL PostgreSQL.",
        "Use the DeepSeek OpenAI-compatible API for the model runtime.",
        "Authentication debugging is unresolved. Next: inspect apps/web/server/request.ts.",
      ],
      value: {
        database: "native WSL PostgreSQL",
        modelRuntime: "DeepSeek OpenAI-compatible API",
        unresolvedIssues: ["Authentication debugging"],
        nextSteps: ["Inspect apps/web/server/request.ts"],
      },
      instruction: "Do not split the conversation into multiple top-level extraction records",
    },
    {
      scenario: "later information superseding an earlier choice",
      texts: [
        "Use Docker PostgreSQL and local vLLM.",
        "The original model URL is http://localhost:8000/v1.",
        "Final decision: switch to native WSL PostgreSQL and the DeepSeek OpenAI-compatible API.",
      ],
      value: {
        database: "native WSL PostgreSQL",
        modelRuntime: { previous: "local vLLM", current: "DeepSeek OpenAI-compatible API" },
      },
      instruction: "Later messages may refine, replace, or supersede earlier statements",
    },
    {
      scenario: "repeated information",
      texts: ["Use PostgreSQL.", "Confirmed: use PostgreSQL.", "The database remains PostgreSQL."],
      value: { database: "PostgreSQL" },
      instruction:
        "Consolidate duplicate, repeated, updated, or related information across messages",
    },
  ])("preserves one merged proposal for $scenario", async ({ texts, value, instruction }) => {
    const fixture = arrange();
    const { conversation, messages, input } = seedWorkUnit(fixture, texts);
    const evidenceBefore = structuredClone(fixture.unitOfWork.view().messages);
    fixture.provider.enqueueResponse(response([mergedChange(messages, value)]));

    const delta = await fixture.service.extract(input);

    expect(fixture.provider.requests).toHaveLength(1);
    const request = fixture.provider.requests[0];
    expect(request?.messages[0]?.content).toContain(instruction);
    expect(request?.messages[0]?.content).toContain(
      "Produce exactly one merged conversation-level extraction proposal",
    );
    expect(JSON.parse(request?.messages[1]?.content ?? "null")).toMatchObject({
      conversation,
      messages: messages.map(({ id, role, author, content, sequence }) => ({
        id,
        role,
        author,
        content,
        sequence,
      })),
    });
    expect(request?.responseFormat?.schema).toMatchObject({
      properties: { changes: { minItems: 1, maxItems: 1 } },
    });
    expect(delta.changes).toHaveLength(1);
    expect(delta.changes[0]).toMatchObject({
      operation: "add",
      proposal: {
        value,
        provenance: [{ conversationId: conversation.id, messageIds: messages.map(({ id }) => id) }],
      },
    });
    expect(fixture.unitOfWork.view().deltas).toEqual([delta]);
    expect(fixture.unitOfWork.view().messages).toEqual(evidenceBefore);
    expect(fixture.unitOfWork.view().projects).toEqual([fixture.project]);
    expect(fixture.unitOfWork.view().commits).toEqual([fixture.genesis]);
    expect(fixture.unitOfWork.view().modelRuns[0]).toMatchObject({
      promptVersion: request?.promptVersion,
      status: "completed",
    });
  });

  it.each([0, 2, 3])(
    "rejects %i top-level changes after the existing single repair attempt",
    async (count) => {
      const fixture = arrange();
      const { messages, input } = seedWorkUnit(fixture, [
        "Database",
        "Model runtime",
        "Authentication",
      ]);
      const changes = Array.from({ length: count }, (_, index) => ({
        ...mergedChange(messages, { topic: index }),
        proposal: { ...mergedChange(messages, { topic: index }).proposal, key: `topic.${index}` },
      }));
      fixture.provider.enqueueResponse(response(changes));
      fixture.provider.enqueueResponse(response(changes));

      await expect(fixture.service.extract(input)).rejects.toMatchObject({ code: "VALIDATION" });
      expect(fixture.provider.requests).toHaveLength(2);
      expect(fixture.unitOfWork.view().deltas).toEqual([]);
      expect(fixture.unitOfWork.view().modelRuns[0]?.status).toBe("failed");
    },
  );

  it("repairs a split response into one merged proposal before persistence", async () => {
    const fixture = arrange();
    const { messages, input } = seedWorkUnit(fixture, ["Use PostgreSQL.", "Use DeepSeek."]);
    fixture.provider.enqueueResponse(
      response(
        messages.map((message, index) => ({
          ...mergedChange([message], { topic: index }),
          proposal: {
            ...mergedChange([message], { topic: index }).proposal,
            key: `topic.${index}`,
          },
        })),
      ),
    );
    const value = { database: "PostgreSQL", modelRuntime: "DeepSeek" };
    fixture.provider.enqueueResponse(response([mergedChange(messages, value)]));

    const delta = await fixture.service.extract(input);

    expect(fixture.provider.requests).toHaveLength(2);
    expect(delta.changes).toHaveLength(1);
    expect(delta.changes[0]).toMatchObject({ proposal: { value } });
    expect(fixture.unitOfWork.view().deltas).toEqual([delta]);
  });

  it("requires a merged proposal instead of a standalone deprecation", async () => {
    const fixture = arrange();
    const { messages, input } = seedWorkUnit(fixture, ["Retire the old database configuration."]);
    const deprecated = response([
      {
        operation: "deprecate",
        targetLogicalItemId: uuid(8_000),
        expectedBaseVersionId: uuid(8_001),
        evidenceMessageIds: messages.map(({ id }) => id),
      },
    ]);
    fixture.provider.enqueueResponse(deprecated);
    fixture.provider.enqueueResponse(deprecated);

    await expect(fixture.service.extract(input)).rejects.toMatchObject({ code: "VALIDATION" });
    expect(fixture.unitOfWork.view().deltas).toEqual([]);
  });

  it("extracts separate conversations in the same project without mixing their evidence", async () => {
    const fixture = arrange();
    const first = seedWorkUnit(fixture, ["Use PostgreSQL.", "Use DeepSeek."], 100);
    const second = seedWorkUnit(fixture, ["Build the search module.", "Add a search index."], 200);
    fixture.provider.enqueueResponse(
      response([mergedChange(first.messages, { database: "PostgreSQL" })]),
    );
    fixture.provider.enqueueResponse(
      response([mergedChange(second.messages, { search: "index" })]),
    );

    const firstDelta = await fixture.service.extract(first.input);
    const secondDelta = await fixture.service.extract(second.input);

    expect(fixture.provider.requests).toHaveLength(2);
    for (const [index, unit] of [first, second].entries()) {
      expect(
        JSON.parse(fixture.provider.requests[index]?.messages[1]?.content ?? "null"),
      ).toMatchObject({
        conversation: unit.conversation,
        messages: unit.messages.map(({ id }) => ({ id })),
      });
    }
    expect(firstDelta.conversationId).toBe(first.conversation.id);
    expect(secondDelta.conversationId).toBe(second.conversation.id);
    expect(firstDelta.changes).toHaveLength(1);
    expect(secondDelta.changes).toHaveLength(1);
    expect(fixture.unitOfWork.view().deltas).toEqual([firstDelta, secondDelta]);

    fixture.provider.enqueueResponse(
      response([mergedChange(second.messages, { search: "index" })]),
    );
    await expect(fixture.service.extract(first.input)).rejects.toMatchObject({
      code: "VALIDATION",
    });
    expect(fixture.unitOfWork.view().deltas).toEqual([firstDelta, secondDelta]);
  });

  it("retains more than 100 evidence references inside one proposal using existing provenance entries", async () => {
    const fixture = arrange();
    const { messages, input } = seedWorkUnit(
      fixture,
      Array.from({ length: 101 }, (_, index) => `Requirement ${index}`),
    );
    fixture.provider.enqueueResponse(
      response([mergedChange(messages, { requirements: messages.map(({ content }) => content) })]),
    );

    const delta = await fixture.service.extract(input);

    expect(delta.changes).toHaveLength(1);
    const change = delta.changes[0];
    if (change === undefined || change.operation === "deprecate")
      throw new Error("Expected a proposal.");
    expect(change.proposal.provenance.flatMap(({ messageIds }) => messageIds)).toEqual(
      messages.map(({ id }) => id),
    );
    expect(change.proposal.provenance.map(({ messageIds }) => messageIds.length)).toEqual([100, 1]);
  });

  it.each([
    {
      scenario: "the message count limit",
      texts: Array.from({ length: 501 }, (_, index) => `Message ${index}`),
    },
    { scenario: "the character budget", texts: ["Earlier choice", "x".repeat(1_000_000)] },
  ])("preserves $scenario and chronological order", async ({ texts }) => {
    const fixture = arrange();
    const { messages, input } = seedWorkUnit(fixture, texts);
    const selected = messages.slice(1);
    fixture.provider.enqueueResponse(
      response([mergedChange(selected, { summary: "Bounded work unit" })]),
    );

    const delta = await fixture.service.extract(input);

    expect(JSON.parse(fixture.provider.requests[0]?.messages[1]?.content ?? "null")).toMatchObject({
      messages: selected.map(({ id, content, sequence }) => ({ id, content, sequence })),
    });
    expect(delta.throughMessageSequence).toBe(texts.length);
    expect(delta.changes).toHaveLength(1);
  });

  it("keeps the requested sequence boundary and excludes incomplete messages", async () => {
    const fixture = arrange();
    const { messages, input } = seedWorkUnit(fixture, [
      "Earlier choice",
      "Updated choice",
      "Later evidence",
    ]);
    const incomplete = messageSchema.parse({
      ...messages[0],
      id: uuid(500),
      clientMessageId: uuid(501),
      sequence: 4,
      content: "Incomplete evidence",
      deliveryState: "streaming",
      completedAt: null,
    });
    await fixture.unitOfWork.run((repositories) =>
      repositories.conversations.insertMessage(incomplete),
    );
    for (const throughMessageSequence of [2, 4]) {
      const selected = messages.filter((message) => message.sequence <= throughMessageSequence);
      fixture.provider.enqueueResponse(
        response([mergedChange(selected, { summary: "Updated choice" })]),
      );

      const delta = await fixture.service.extract({ ...input, throughMessageSequence });

      expect(
        JSON.parse(fixture.provider.requests.at(-1)?.messages[1]?.content ?? "null"),
      ).toMatchObject({
        messages: selected.map(({ id }) => ({ id })),
      });
      expect(delta.throughMessageSequence).toBe(selected.length);
      expect(delta.changes).toHaveLength(1);
    }
  });

  it.each(["update", "supersede"] as const)(
    "preserves the existing %s operation for a merged record",
    async (operation) => {
      const fixture = arrange();
      const { messages, input } = seedWorkUnit(fixture, [
        "Use Docker PostgreSQL",
        "Switch to native WSL PostgreSQL",
      ]);
      fixture.provider.enqueueResponse(
        response([
          {
            ...mergedChange(messages, { database: "native WSL PostgreSQL" }),
            operation,
            targetLogicalItemId: uuid(8_000),
            expectedBaseVersionId: uuid(8_001),
          },
        ]),
      );

      const delta = await fixture.service.extract(input);

      expect(delta.changes).toHaveLength(1);
      expect(delta.changes[0]).toMatchObject({
        operation,
        targetLogicalItemId: uuid(8_000),
        expectedBaseVersionId: uuid(8_001),
        proposal: {
          value: { database: "native WSL PostgreSQL" },
          explicitSupersedesVersionId: operation === "supersede" ? uuid(8_001) : null,
        },
      });
      expect(fixture.unitOfWork.view().commits).toEqual([fixture.genesis]);
    },
  );
});
