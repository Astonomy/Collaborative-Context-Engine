import { ModelProviderError } from "@cce/application";
import type { ModelRequest, ModelResponse, ModelStreamEvent } from "@cce/application";
import { describe, expect, it } from "vitest";

import { FakeModelProvider } from "./fake-model-provider";

const request: ModelRequest = {
  profile: "medium",
  purpose: "chat",
  messages: [{ role: "user", content: "Hello" }],
  promptId: "chat.answer",
  promptVersion: 1,
  temperature: 0.2,
  responseFormat: null,
};

const response: ModelResponse = {
  providerResponseId: "response-1",
  provider: "fake",
  model: "fake-model",
  content: "Hello back",
  finishReason: "stop",
  usage: { inputTokens: 2, cachedTokens: 0, outputTokens: 2 },
};

describe("FakeModelProvider", () => {
  it("scripts generation and records requests", async () => {
    const provider = new FakeModelProvider([
      { operation: "generate", outcome: { type: "response", response } },
    ]);

    await expect(provider.generate(request)).resolves.toEqual(response);
    expect(provider.generateRequests).toEqual([request]);
    expect(provider.remainingStepCount).toBe(0);
    expect(() => provider.assertExhausted()).not.toThrow();
  });

  it("scripts normalized failures", async () => {
    const error = new ModelProviderError("RATE_LIMIT", "Rate limited.", {
      retryable: true,
      statusCode: 429,
    });
    const provider = new FakeModelProvider([
      { operation: "generate", outcome: { type: "error", error } },
    ]);

    await expect(provider.generate(request)).rejects.toBe(error);
  });

  it("scripts a stream that fails after emitted evidence", async () => {
    const events: readonly ModelStreamEvent[] = [
      {
        type: "start",
        providerResponseId: "response-1",
        provider: "fake-provider",
        model: "fake-model",
      },
      { type: "text_delta", text: "partial" },
    ];
    const error = new ModelProviderError("INTERRUPTED_STREAM", "Interrupted.", {
      retryable: true,
    });
    const provider = new FakeModelProvider([{ operation: "stream", events, terminalError: error }]);

    const iterator = provider.stream(request)[Symbol.asyncIterator]();
    await expect(iterator.next()).resolves.toEqual({ done: false, value: events[0] });
    await expect(iterator.next()).resolves.toEqual({ done: false, value: events[1] });
    await expect(iterator.next()).rejects.toBe(error);
    expect(provider.streamRequests).toEqual([request]);
  });

  it("completes a scripted successful stream", async () => {
    const provider = new FakeModelProvider([
      {
        operation: "stream",
        events: [{ type: "finish", finishReason: "stop" }],
      },
    ]);

    const iterator = provider.stream(request)[Symbol.asyncIterator]();
    await expect(iterator.next()).resolves.toEqual({
      done: false,
      value: { type: "finish", finishReason: "stop" },
    });
    await expect(iterator.next()).resolves.toEqual({ done: true, value: undefined });
  });

  it("fails loudly when calls do not match the script", async () => {
    const provider = new FakeModelProvider([{ operation: "stream", events: [] }]);

    await expect(provider.generate(request)).rejects.toThrow("Expected a stream call");
    expect(() => provider.assertExhausted()).not.toThrow();
  });

  it("detects missing, reversed, and unconsumed script steps", async () => {
    const emptyProvider = new FakeModelProvider();
    await expect(emptyProvider.generate(request)).rejects.toThrow("Unexpected generate");
    await expect(collectStream(emptyProvider.stream(request))).rejects.toThrow("Unexpected stream");

    const reversedProvider = new FakeModelProvider([
      { operation: "generate", outcome: { type: "response", response } },
    ]);
    await expect(collectStream(reversedProvider.stream(request))).rejects.toThrow(
      "Expected a generate call",
    );

    const unconsumedProvider = new FakeModelProvider([
      { operation: "generate", outcome: { type: "response", response } },
    ]);
    expect(() => unconsumedProvider.assertExhausted()).toThrow("1 unconsumed step");
  });
});

async function collectStream(stream: AsyncIterable<ModelStreamEvent>): Promise<void> {
  for await (const event of stream) {
    expect(event).toBeDefined();
  }
}
