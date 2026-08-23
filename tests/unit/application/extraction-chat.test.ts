import {
  ChatService,
  ContextService,
  ConversationService,
  ExtractionService,
  ModelProviderError,
  type ChatEvent,
  type ModelResponse,
} from "@cce/application";
import { ScriptedModelProvider } from "@cce/test-support";
import { describe, expect, it } from "vitest";

import { createFixture, idsFrom, seedConversation, uuid } from "./fixtures";

function response(content: string): ModelResponse {
  return {
    providerResponseId: "response-1",
    provider: "test-provider",
    model: "test-model",
    content,
    finishReason: "stop",
    usage: { inputTokens: 10, cachedTokens: 2, outputTokens: 5 },
  };
}

function extractionJson(evidenceMessageId: string): string {
  return JSON.stringify({
    changes: [
      {
        operation: "add",
        proposal: {
          kind: "fact",
          key: "database.engine",
          value: "PostgreSQL",
          scope: { tags: ["database"] },
          confidence: 0.98,
          evidenceMessageIds: [evidenceMessageId],
        },
      },
    ],
  });
}

async function collect(source: AsyncIterable<ChatEvent>): Promise<ChatEvent[]> {
  const events: ChatEvent[] = [];
  for await (const event of source) {
    events.push(event);
  }
  return events;
}

describe("ExtractionService", () => {
  it("turns strict structured output into an evidence-linked proposal, never a commit", async () => {
    const fixture = createFixture();
    const { conversation, message } = seedConversation(fixture);
    const provider = new ScriptedModelProvider();
    provider.enqueueResponse(response(extractionJson(message.id)));
    const service = new ExtractionService(
      fixture.unitOfWork,
      provider,
      idsFrom(100),
      fixture.clock,
      fixture.hasher,
    );

    const delta = await service.extract({
      projectId: fixture.project.id,
      conversationId: conversation.id,
      actorUserId: fixture.user.id,
    });

    expect(delta.baseCommitId).toBe(fixture.project.headCommitId);
    expect(delta.changes).toMatchObject([
      {
        operation: "add",
        proposal: {
          kind: "fact",
          authority: "authoritative",
          provenance: [{ messageIds: [message.id], modelRunId: uuid(100) }],
        },
      },
    ]);
    expect(fixture.unitOfWork.view().commits).toHaveLength(1);
    expect(fixture.unitOfWork.view().deltas).toEqual([delta]);
    expect(fixture.unitOfWork.view().modelRuns[0]).toMatchObject({
      status: "completed",
      provider: "test-provider",
      model: "test-model",
    });
    expect(provider.requests[0]?.responseFormat).toMatchObject({
      name: "context_delta_extraction",
      strict: true,
    });
  });

  it("retries malformed output once and records a terminal failed ModelRun", async () => {
    const fixture = createFixture();
    const { conversation } = seedConversation(fixture);
    const provider = new ScriptedModelProvider();
    provider.enqueueResponse(response("not json"));
    provider.enqueueResponse(response('{"changes":"wrong"}'));
    const service = new ExtractionService(
      fixture.unitOfWork,
      provider,
      idsFrom(100),
      fixture.clock,
      fixture.hasher,
    );

    await expect(
      service.extract({
        projectId: fixture.project.id,
        conversationId: conversation.id,
        actorUserId: fixture.user.id,
      }),
    ).rejects.toMatchObject({ code: "VALIDATION" });
    expect(provider.requests).toHaveLength(2);
    expect(fixture.unitOfWork.view().modelRuns[0]).toMatchObject({
      status: "failed",
      errorCode: "MALFORMED_STRUCTURED_OUTPUT",
    });
    expect(fixture.unitOfWork.view().deltas).toEqual([]);
  });

  it("retries a provider-level malformed structured response once", async () => {
    const fixture = createFixture();
    const { conversation, message } = seedConversation(fixture);
    const provider = new ScriptedModelProvider();
    provider.enqueueResponse(
      new ModelProviderError("MALFORMED_RESPONSE", "Provider rejected invalid JSON.", {
        retryable: false,
      }),
    );
    provider.enqueueResponse(response(extractionJson(message.id)));
    const service = new ExtractionService(
      fixture.unitOfWork,
      provider,
      idsFrom(100),
      fixture.clock,
      fixture.hasher,
    );

    await expect(
      service.extract({
        projectId: fixture.project.id,
        conversationId: conversation.id,
        actorUserId: fixture.user.id,
      }),
    ).resolves.toMatchObject({ changes: [{ operation: "add" }] });
    expect(provider.requests).toHaveLength(2);
    expect(fixture.unitOfWork.view().modelRuns[0]?.status).toBe("completed");
  });

  it("rejects invented evidence and still closes the ModelRun", async () => {
    const fixture = createFixture();
    const { conversation } = seedConversation(fixture);
    const provider = new ScriptedModelProvider();
    provider.enqueueResponse(response(extractionJson(uuid(999))));
    const service = new ExtractionService(
      fixture.unitOfWork,
      provider,
      idsFrom(100),
      fixture.clock,
      fixture.hasher,
    );

    await expect(
      service.extract({
        projectId: fixture.project.id,
        conversationId: conversation.id,
        actorUserId: fixture.user.id,
      }),
    ).rejects.toMatchObject({ code: "VALIDATION" });
    expect(fixture.unitOfWork.view().modelRuns[0]?.status).toBe("failed");
    expect(fixture.unitOfWork.view().deltas).toHaveLength(0);
  });

  it("rejects a truncated structured response and closes the ModelRun", async () => {
    const fixture = createFixture();
    const { conversation, message } = seedConversation(fixture);
    const provider = new ScriptedModelProvider();
    provider.enqueueResponse({
      ...response(extractionJson(message.id)),
      finishReason: "length",
    });
    const service = new ExtractionService(
      fixture.unitOfWork,
      provider,
      idsFrom(100),
      fixture.clock,
      fixture.hasher,
    );

    await expect(
      service.extract({
        projectId: fixture.project.id,
        conversationId: conversation.id,
        actorUserId: fixture.user.id,
      }),
    ).rejects.toMatchObject({ code: "DEPENDENCY_UNAVAILABLE" });
    expect(fixture.unitOfWork.view().modelRuns[0]).toMatchObject({
      status: "failed",
      errorCode: "MALFORMED_RESPONSE",
    });
    expect(fixture.unitOfWork.view().deltas).toEqual([]);
  });

  it("terminalizes validation failures raised while assembling the Delta", async () => {
    const fixture = createFixture();
    const { conversation, message } = seedConversation(fixture);
    const candidate = JSON.parse(extractionJson(message.id)) as {
      changes: unknown[];
    };
    candidate.changes.push(structuredClone(candidate.changes[0]));
    const provider = new ScriptedModelProvider();
    provider.enqueueResponse(response(JSON.stringify(candidate)));
    const service = new ExtractionService(
      fixture.unitOfWork,
      provider,
      idsFrom(100),
      fixture.clock,
      fixture.hasher,
    );

    await expect(
      service.extract({
        projectId: fixture.project.id,
        conversationId: conversation.id,
        actorUserId: fixture.user.id,
      }),
    ).rejects.toMatchObject({ code: "VALIDATION" });
    expect(fixture.unitOfWork.view().modelRuns[0]).toMatchObject({
      status: "failed",
      errorCode: "MALFORMED_STRUCTURED_OUTPUT",
    });
    expect(fixture.unitOfWork.view().deltas).toEqual([]);
  });
});

describe("ChatService", () => {
  it("persists both sides of a completed stream and includes canonical context", async () => {
    const fixture = createFixture();
    const { conversation } = seedConversation(fixture);
    const provider = new ScriptedModelProvider();
    provider.enqueueStream([
      {
        type: "start",
        providerResponseId: "stream-1",
        provider: "test-provider",
        model: "test-model",
      },
      { type: "text_delta", text: "Use " },
      { type: "text_delta", text: "PostgreSQL." },
      {
        type: "usage",
        usage: { inputTokens: 20, cachedTokens: 4, outputTokens: 3 },
      },
      { type: "finish", finishReason: "stop" },
    ]);
    const conversations = new ConversationService(
      fixture.unitOfWork,
      idsFrom(100),
      fixture.clock,
    );
    const service = new ChatService(
      fixture.unitOfWork,
      conversations,
      new ContextService(fixture.unitOfWork),
      provider,
      idsFrom(200),
      fixture.clock,
      fixture.hasher,
    );

    const events = await collect(
      service.chat({
        projectId: fixture.project.id,
        conversationId: conversation.id,
        actorUserId: fixture.user.id,
        clientMessageId: uuid(80),
        content: "What database should we use?",
      }),
    );

    expect(events.map((event) => event.type)).toEqual([
      "user_persisted",
      "assistant_started",
      "text_delta",
      "text_delta",
      "completed",
    ]);
    expect(fixture.unitOfWork.view().messages).toHaveLength(3);
    expect(fixture.unitOfWork.view().messages[2]).toMatchObject({
      role: "assistant",
      deliveryState: "completed",
      content: "Use PostgreSQL.",
    });
    expect(fixture.unitOfWork.view().modelRuns[0]).toMatchObject({
      status: "completed",
      inputTokens: 20,
      cachedTokens: 4,
      outputTokens: 3,
    });
    expect(provider.requests[0]?.messages[0]?.content).toContain(
      fixture.project.headCommitId,
    );
  });

  it("persists partial text as interrupted when a stream ends without finish", async () => {
    const fixture = createFixture();
    const { conversation } = seedConversation(fixture);
    const provider = new ScriptedModelProvider();
    provider.enqueueStream([
      {
        type: "start",
        providerResponseId: "stream-2",
        provider: "test-provider",
        model: "test-model",
      },
      { type: "text_delta", text: "partial" },
    ]);
    const service = new ChatService(
      fixture.unitOfWork,
      new ConversationService(fixture.unitOfWork, idsFrom(100), fixture.clock),
      new ContextService(fixture.unitOfWork),
      provider,
      idsFrom(200),
      fixture.clock,
      fixture.hasher,
    );

    await expect(
      collect(
        service.chat({
          projectId: fixture.project.id,
          conversationId: conversation.id,
          actorUserId: fixture.user.id,
          clientMessageId: uuid(81),
          content: "Answer me",
        }),
      ),
    ).rejects.toMatchObject({ code: "DEPENDENCY_UNAVAILABLE" });
    expect(fixture.unitOfWork.view().messages[2]).toMatchObject({
      deliveryState: "interrupted",
      content: "partial",
      errorCode: "INTERRUPTED_STREAM",
    });
    expect(fixture.unitOfWork.view().modelRuns[0]).toMatchObject({
      status: "interrupted",
      errorCode: "INTERRUPTED_STREAM",
    });
  });

  it("terminalizes the pending assistant when the stream consumer disconnects", async () => {
    const fixture = createFixture();
    const { conversation } = seedConversation(fixture);
    const provider = new ScriptedModelProvider();
    provider.enqueueStream([
      {
        type: "start",
        providerResponseId: "stream-disconnected",
        provider: "test-provider",
        model: "test-model",
      },
      { type: "text_delta", text: "never consumed" },
      { type: "finish", finishReason: "stop" },
    ]);
    const service = new ChatService(
      fixture.unitOfWork,
      new ConversationService(fixture.unitOfWork, idsFrom(100), fixture.clock),
      new ContextService(fixture.unitOfWork),
      provider,
      idsFrom(200),
      fixture.clock,
      fixture.hasher,
    );
    const stream = service.chat({
      projectId: fixture.project.id,
      conversationId: conversation.id,
      actorUserId: fixture.user.id,
      clientMessageId: uuid(82),
      content: "Disconnect after the response starts",
    });
    const iterator = stream[Symbol.asyncIterator]();

    expect((await iterator.next()).value?.type).toBe("user_persisted");
    expect((await iterator.next()).value?.type).toBe("assistant_started");
    await iterator.return?.();

    expect(fixture.unitOfWork.view().messages[2]).toMatchObject({
      deliveryState: "interrupted",
      errorCode: "INTERRUPTED_STREAM",
    });
    expect(fixture.unitOfWork.view().modelRuns[0]).toMatchObject({
      status: "interrupted",
      errorCode: "INTERRUPTED_STREAM",
    });
  });

  it("rejects a truncated finish reason instead of committing partial output", async () => {
    const fixture = createFixture();
    const { conversation } = seedConversation(fixture);
    const provider = new ScriptedModelProvider();
    provider.enqueueStream([
      {
        type: "start",
        providerResponseId: "stream-truncated",
        provider: "test-provider",
        model: "test-model",
      },
      { type: "text_delta", text: "partial" },
      { type: "finish", finishReason: "length" },
    ]);
    const service = new ChatService(
      fixture.unitOfWork,
      new ConversationService(fixture.unitOfWork, idsFrom(100), fixture.clock),
      new ContextService(fixture.unitOfWork),
      provider,
      idsFrom(200),
      fixture.clock,
      fixture.hasher,
    );

    await expect(
      collect(
        service.chat({
          projectId: fixture.project.id,
          conversationId: conversation.id,
          actorUserId: fixture.user.id,
          clientMessageId: uuid(83),
          content: "Do not accept a truncated response",
        }),
      ),
    ).rejects.toMatchObject({ code: "DEPENDENCY_UNAVAILABLE" });
    expect(fixture.unitOfWork.view().messages[2]).toMatchObject({
      deliveryState: "failed",
      errorCode: "MALFORMED_RESPONSE",
    });
    expect(fixture.unitOfWork.view().modelRuns[0]).toMatchObject({
      status: "failed",
      errorCode: "MALFORMED_RESPONSE",
    });
  });

  it("rejects stream events emitted before provider identity starts", async () => {
    const fixture = createFixture();
    const { conversation } = seedConversation(fixture);
    const provider = new ScriptedModelProvider();
    provider.enqueueStream([
      { type: "text_delta", text: "identity-free" },
      { type: "finish", finishReason: "stop" },
    ]);
    const service = new ChatService(
      fixture.unitOfWork,
      new ConversationService(fixture.unitOfWork, idsFrom(100), fixture.clock),
      new ContextService(fixture.unitOfWork),
      provider,
      idsFrom(200),
      fixture.clock,
      fixture.hasher,
    );

    await expect(
      collect(
        service.chat({
          projectId: fixture.project.id,
          conversationId: conversation.id,
          actorUserId: fixture.user.id,
          clientMessageId: uuid(86),
          content: "Reject malformed stream ordering",
        }),
      ),
    ).rejects.toMatchObject({ code: "DEPENDENCY_UNAVAILABLE" });
    expect(fixture.unitOfWork.view().messages[2]).toMatchObject({
      deliveryState: "failed",
      errorCode: "MALFORMED_RESPONSE",
    });
  });

  it("replays a completed reply for the same client message without another model call", async () => {
    const fixture = createFixture();
    const { conversation } = seedConversation(fixture);
    const provider = new ScriptedModelProvider();
    provider.enqueueStream([
      {
        type: "start",
        providerResponseId: "stream-idempotent",
        provider: "test-provider",
        model: "test-model",
      },
      { type: "text_delta", text: "One answer." },
      { type: "usage", usage: { inputTokens: 4, cachedTokens: 0, outputTokens: 2 } },
      { type: "finish", finishReason: "stop" },
    ]);
    const service = new ChatService(
      fixture.unitOfWork,
      new ConversationService(fixture.unitOfWork, idsFrom(100), fixture.clock),
      new ContextService(fixture.unitOfWork),
      provider,
      idsFrom(200),
      fixture.clock,
      fixture.hasher,
    );
    const request = {
      projectId: fixture.project.id,
      conversationId: conversation.id,
      actorUserId: fixture.user.id,
      clientMessageId: uuid(84),
      content: "Answer exactly once",
    };

    await collect(service.chat(request));
    const replay = await collect(service.chat(request));

    expect(replay.map((event) => event.type)).toEqual([
      "user_persisted",
      "assistant_started",
      "completed",
    ]);
    expect(provider.requests).toHaveLength(1);
    expect(fixture.unitOfWork.view().messages).toHaveLength(3);
    expect(fixture.unitOfWork.view().modelRuns).toHaveLength(1);
    expect(fixture.unitOfWork.view().messages[2]?.replyToMessageId).toBe(
      fixture.unitOfWork.view().messages[1]?.id,
    );
  });

  it("rejects reuse of a client message id with different content", async () => {
    const fixture = createFixture();
    const { conversation } = seedConversation(fixture);
    const provider = new ScriptedModelProvider();
    provider.enqueueStream([
      {
        type: "start",
        providerResponseId: "stream-key-binding",
        provider: "test-provider",
        model: "test-model",
      },
      { type: "text_delta", text: "Bound answer." },
      { type: "usage", usage: { inputTokens: 4, cachedTokens: 0, outputTokens: 2 } },
      { type: "finish", finishReason: "stop" },
    ]);
    const service = new ChatService(
      fixture.unitOfWork,
      new ConversationService(fixture.unitOfWork, idsFrom(100), fixture.clock),
      new ContextService(fixture.unitOfWork),
      provider,
      idsFrom(200),
      fixture.clock,
      fixture.hasher,
    );
    const base = {
      projectId: fixture.project.id,
      conversationId: conversation.id,
      actorUserId: fixture.user.id,
      clientMessageId: uuid(85),
    };
    await collect(service.chat({ ...base, content: "Original" }));

    await expect(
      collect(service.chat({ ...base, content: "Different" })),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    expect(provider.requests).toHaveLength(1);
  });
});
