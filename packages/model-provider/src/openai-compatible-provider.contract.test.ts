import { createServer } from "node:http";
import type { IncomingMessage, Server, ServerResponse } from "node:http";

import type { ModelRequest, ModelStreamEvent } from "@cce/application";
import { describe, expect, it } from "vitest";

import type { QwenVllmProviderConfiguration } from "./configuration";
import { QwenVllmModelProvider } from "./openai-compatible-provider";

type FakeServerHandler = (
  request: IncomingMessage,
  response: ServerResponse,
) => Promise<void> | void;

interface RunningFakeServer {
  readonly baseUrl: string;
  close(): Promise<void>;
}

const baseConfiguration: Omit<QwenVllmProviderConfiguration, "baseUrl"> = {
  apiKey: "contract-test-secret",
  chatModel: "qwen-chat",
  extractorModel: "qwen-extractor",
  classifierModel: "qwen-classifier",
  resolverModel: "qwen-resolver",
  requestTimeoutMs: 1_000,
};

const baseRequest: ModelRequest = {
  profile: "medium",
  purpose: "chat",
  messages: [
    { role: "system", content: "Answer concisely." },
    { role: "user", content: "Hello" },
  ],
  promptId: "chat.answer",
  promptVersion: 3,
  temperature: 0.2,
  responseFormat: null,
};

const maximumInt32 = 2_147_483_647;
const maximumProviderResponseIdLength = 500;
const maximumProviderNameLength = 100;
const maximumModelNameLength = 200;
const maximumContentLength = 1_000_000;
const maximumCompletionBodyBytes = 8_000_000;
const maximumErrorBodyBytes = 65_536;
const maximumSseEventBytes = 8_000_000;
const maximumSseStreamBytes = 16_000_000;

describe("Qwen/vLLM OpenAI-compatible provider contract", () => {
  it("generates a normalized response and sends credentials only in the header", async () => {
    await withFakeServer(
      async (incoming, outgoing) => {
        expect(incoming.method).toBe("POST");
        expect(incoming.url).toBe("/v1/chat/completions");
        expect(incoming.headers.authorization).toBe("Bearer contract-test-secret");
        const body = await readJsonRequest(incoming);
        expect(body).toMatchObject({
          model: "qwen-chat",
          messages: baseRequest.messages,
          temperature: 0.2,
          stream: false,
        });
        expect(JSON.stringify(body)).not.toContain("contract-test-secret");
        sendJson(outgoing, 200, completionResponse("Hello back"));
      },
      async (baseUrl) => {
        const response = await provider(baseUrl).generate(baseRequest);
        expect(response).toEqual({
          providerResponseId: "chatcmpl-1",
          provider: "qwen-vllm",
          model: "Qwen/Qwen3-8B",
          content: "Hello back",
          finishReason: "stop",
          usage: { inputTokens: 8, cachedTokens: 3, outputTokens: 2 },
        });
      },
    );
  });

  it("passes JSON Schema structured-output configuration and validates returned JSON", async () => {
    const request: ModelRequest = {
      ...baseRequest,
      purpose: "extraction",
      responseFormat: {
        name: "context_delta",
        schema: {
          type: "object",
          properties: { summary: { type: "string" } },
          required: ["summary"],
          additionalProperties: false,
        },
        strict: true,
      },
    };
    await withFakeServer(
      async (incoming, outgoing) => {
        const body = await readJsonRequest(incoming);
        expect(body).toMatchObject({
          model: "qwen-extractor",
          response_format: {
            type: "json_schema",
            json_schema: request.responseFormat,
          },
        });
        sendJson(outgoing, 200, completionResponse('{"summary":"accepted"}'));
      },
      async (baseUrl) => {
        await expect(provider(baseUrl).generate(request)).resolves.toMatchObject({
          content: '{"summary":"accepted"}',
        });
      },
    );
  });

  it("rejects malformed structured output", async () => {
    await withFakeServer(
      (_incoming, outgoing) => {
        sendJson(outgoing, 200, completionResponse('{"summary":'));
      },
      async (baseUrl) => {
        await expect(
          provider(baseUrl).generate({
            ...baseRequest,
            responseFormat: {
              name: "context_delta",
              schema: { type: "object" },
              strict: true,
            },
          }),
        ).rejects.toMatchObject({ code: "MALFORMED_RESPONSE", retryable: false });
      },
    );
  });

  it("rejects valid JSON that violates the requested structured-output schema", async () => {
    await withFakeServer(
      (_incoming, outgoing) => {
        sendJson(outgoing, 200, completionResponse('{"unexpected":true}'));
      },
      async (baseUrl) => {
        await expect(
          provider(baseUrl).generate({
            ...baseRequest,
            responseFormat: {
              name: "context_delta",
              schema: {
                type: "object",
                properties: { summary: { type: "string" } },
                required: ["summary"],
                additionalProperties: false,
              },
              strict: true,
            },
          }),
        ).rejects.toMatchObject({ code: "MALFORMED_RESPONSE", retryable: false });
      },
    );
  });

  it("streams fragmented SSE events in stable order", async () => {
    await withFakeServer(
      async (incoming, outgoing) => {
        const body = await readJsonRequest(incoming);
        expect(body).toMatchObject({
          model: "qwen-chat",
          stream: true,
          stream_options: { include_usage: true },
        });
        outgoing.writeHead(200, { "content-type": "text/event-stream; charset=utf-8" });
        outgoing.write(
          'data: {"id":"chatcmpl-stream","model":"Qwen/Qwen3-8B","choices":[{"delta":{"role":"assistant","content":"Hel"},"finish_reason":null}]}\n',
        );
        outgoing.write("\n");
        outgoing.write(
          'data: {"id":"chatcmpl-stream","model":"Qwen/Qwen3-8B","choices":[{"delta":{"content":"lo"},"finish_reason":"stop"}]}\r\n\r\n',
        );
        outgoing.write(
          'data: {"id":"chatcmpl-stream","model":"Qwen/Qwen3-8B","choices":[],"usage":{"prompt_tokens":8,"completion_tokens":2}}\n\n',
        );
        outgoing.end("data: [DONE]\n\n");
      },
      async (baseUrl) => {
        await expect(collect(provider(baseUrl).stream(baseRequest))).resolves.toEqual([
          {
            type: "start",
            providerResponseId: "chatcmpl-stream",
            provider: "qwen-vllm",
            model: "Qwen/Qwen3-8B",
          },
          { type: "text_delta", text: "Hel" },
          { type: "text_delta", text: "lo" },
          {
            type: "usage",
            usage: { inputTokens: 8, cachedTokens: 0, outputTokens: 2 },
          },
          { type: "finish", finishReason: "stop" },
        ]);
      },
    );
  });

  it("normalizes an interrupted SSE connection after preserving partial events", async () => {
    await withFakeServer(
      (_incoming, outgoing) => {
        outgoing.writeHead(200, { "content-type": "text/event-stream" });
        outgoing.end(
          'data: {"id":"partial","model":"Qwen","choices":[{"delta":{"content":"partial"},"finish_reason":"stop"}]}\n\n',
        );
      },
      async (baseUrl) => {
        await expect(collect(provider(baseUrl).stream(baseRequest))).rejects.toMatchObject({
          code: "INTERRUPTED_STREAM",
          retryable: true,
        });
      },
    );
  });

  it("normalizes a malformed SSE event", async () => {
    await withFakeServer(
      (_incoming, outgoing) => {
        outgoing.writeHead(200, { "content-type": "text/event-stream" });
        outgoing.end("data: {not-json}\n\ndata: [DONE]\n\n");
      },
      async (baseUrl) => {
        await expect(collect(provider(baseUrl).stream(baseRequest))).rejects.toMatchObject({
          code: "MALFORMED_RESPONSE",
        });
      },
    );
  });

  it("normalizes request timeout without exposing endpoint or credentials", async () => {
    await withFakeServer(
      async (incoming) => {
        await new Promise<void>((resolve) => incoming.once("aborted", resolve));
      },
      async (baseUrl) => {
        const timedProvider = provider(baseUrl, { requestTimeoutMs: 20 });
        let thrown: unknown;
        try {
          await timedProvider.generate(baseRequest);
        } catch (error) {
          thrown = error;
        }
        expect(thrown).toMatchObject({ code: "TIMEOUT", retryable: true, statusCode: null });
        if (!(thrown instanceof Error)) {
          throw new TypeError("Expected the provider to throw an Error.");
        }
        expect(thrown.message).not.toContain(baseUrl);
        expect(thrown.message).not.toContain("contract-test-secret");
      },
    );
  });

  it("normalizes connection failure", async () => {
    const server = await startFakeServer((_incoming, outgoing) => {
      outgoing.end();
    });
    await server.close();

    await expect(provider(server.baseUrl).generate(baseRequest)).rejects.toMatchObject({
      code: "CONNECTION",
      retryable: true,
      statusCode: null,
    });
  });

  it.each([401, 403])("normalizes HTTP %i as an authentication failure", async (statusCode) => {
    await withFakeServer(
      (_incoming, outgoing) => {
        sendJson(outgoing, statusCode, {
          error: { code: "invalid_api_key", message: "The supplied key was rejected." },
        });
      },
      async (baseUrl) => {
        await expect(provider(baseUrl).generate(baseRequest)).rejects.toMatchObject({
          code: "AUTHENTICATION",
          retryable: false,
          statusCode,
        });
      },
    );
  });

  it("normalizes rate limiting", async () => {
    await expectHttpError(
      429,
      { error: { code: "rate_limit_exceeded" } },
      {
        code: "RATE_LIMIT",
        retryable: true,
        statusCode: 429,
      },
    );
  });

  it("normalizes server errors", async () => {
    await expectHttpError(500, "not-json", {
      code: "SERVER",
      retryable: true,
      statusCode: 500,
    });
  });

  it("normalizes an unavailable configured model", async () => {
    await expectHttpError(
      404,
      {
        error: { code: "model_not_found", message: "The requested model was not found." },
      },
      {
        code: "MODEL_UNAVAILABLE",
        retryable: false,
        statusCode: 404,
      },
    );
  });

  it("normalizes provider-specific structured-output incompatibility", async () => {
    await expectHttpError(
      400,
      {
        error: {
          code: "unsupported_parameter",
          param: "response_format",
          message: "json_schema response format is not supported",
        },
      },
      {
        code: "INCOMPATIBLE_CAPABILITY",
        retryable: false,
        statusCode: 400,
      },
    );
  });

  it("normalizes a malformed successful JSON envelope", async () => {
    await withFakeServer(
      (_incoming, outgoing) => {
        outgoing.writeHead(200, { "content-type": "application/json" });
        outgoing.end("not-json");
      },
      async (baseUrl) => {
        await expect(provider(baseUrl).generate(baseRequest)).rejects.toMatchObject({
          code: "MALFORMED_RESPONSE",
          retryable: false,
          statusCode: 200,
        });
      },
    );
  });

  it("rejects a successful but structurally invalid completion envelope", async () => {
    await withFakeServer(
      (_incoming, outgoing) => {
        sendJson(outgoing, 200, { id: "missing-required-fields" });
      },
      async (baseUrl) => {
        await expect(provider(baseUrl).generate(baseRequest)).rejects.toMatchObject({
          code: "MALFORMED_RESPONSE",
        });
      },
    );
  });

  it("rejects a completion without textual content", async () => {
    await withFakeServer(
      (_incoming, outgoing) => {
        sendJson(outgoing, 200, completionResponse(null));
      },
      async (baseUrl) => {
        await expect(provider(baseUrl).generate(baseRequest)).rejects.toMatchObject({
          code: "MALFORMED_RESPONSE",
        });
      },
    );
  });

  it.each([
    [
      "an overlong response id",
      completionEnvelope({ id: "r".repeat(maximumProviderResponseIdLength + 1) }),
    ],
    [
      "an overlong model name",
      completionEnvelope({ model: "m".repeat(maximumModelNameLength + 1) }),
    ],
    [
      "an overlong provider name",
      completionEnvelope({ provider: "p".repeat(maximumProviderNameLength + 1) }),
    ],
    ["a contradictory provider name", completionEnvelope({ provider: "other-provider" })],
    ["overlong content", completionEnvelope({ content: "c".repeat(maximumContentLength + 1) })],
    ["an unknown finish reason", completionEnvelope({ finishReason: "server_shutdown" })],
    ["a missing finish reason", completionEnvelope({ finishReason: null })],
    [
      "negative token usage",
      completionEnvelope({
        usage: { prompt_tokens: -1, completion_tokens: 2 },
      }),
    ],
    [
      "fractional token usage",
      completionEnvelope({
        usage: { prompt_tokens: 8, completion_tokens: 1.5 },
      }),
    ],
    [
      "token usage above int32",
      completionEnvelope({
        usage: { prompt_tokens: 8, completion_tokens: maximumInt32 + 1 },
      }),
    ],
    [
      "cached usage above input usage",
      completionEnvelope({
        usage: {
          prompt_tokens: 8,
          completion_tokens: 2,
          prompt_tokens_details: { cached_tokens: 9 },
        },
      }),
    ],
  ])("rejects a completion with %s", async (_label, responseBody) => {
    await expectMalformedCompletion(responseBody);
  });

  it("accepts response values exactly at their persisted boundaries", async () => {
    const content = "c".repeat(maximumContentLength);
    await withFakeServer(
      (_incoming, outgoing) => {
        sendJson(
          outgoing,
          200,
          completionEnvelope({
            id: "r".repeat(maximumProviderResponseIdLength),
            model: "m".repeat(maximumModelNameLength),
            content,
            usage: {
              prompt_tokens: maximumInt32,
              completion_tokens: maximumInt32,
              prompt_tokens_details: { cached_tokens: maximumInt32 },
            },
          }),
        );
      },
      async (baseUrl) => {
        const response = await provider(baseUrl).generate(baseRequest);
        expect(response.providerResponseId).toHaveLength(maximumProviderResponseIdLength);
        expect(response.provider).toBe("qwen-vllm");
        expect(response.model).toHaveLength(maximumModelNameLength);
        expect(response.content).toHaveLength(maximumContentLength);
        expect(response.usage).toEqual({
          inputTokens: maximumInt32,
          cachedTokens: maximumInt32,
          outputTokens: maximumInt32,
        });
      },
    );
  });

  it("rejects an oversized completion body before parsing its envelope", async () => {
    await expectMalformedCompletion(
      completionEnvelope({ padding: "p".repeat(maximumCompletionBodyBytes) }),
    );
  });

  it("bounds oversized HTTP error bodies and maps from the trusted status", async () => {
    await withFakeServer(
      (_incoming, outgoing) => {
        sendJson(outgoing, 404, {
          error: { code: "model_not_found", message: "untrusted oversized body" },
          padding: "p".repeat(maximumErrorBodyBytes),
        });
      },
      async (baseUrl) => {
        await expect(
          provider(baseUrl, { requestTimeoutMs: 10_000 }).generate(baseRequest),
        ).rejects.toMatchObject({
          code: "INCOMPATIBLE_CAPABILITY",
          retryable: false,
          statusCode: 404,
        });
      },
    );
  });

  it("requires an event-stream response for streaming calls", async () => {
    await withFakeServer(
      (_incoming, outgoing) => {
        sendJson(outgoing, 200, completionResponse("not a stream"));
      },
      async (baseUrl) => {
        await expect(collect(provider(baseUrl).stream(baseRequest))).rejects.toMatchObject({
          code: "INCOMPATIBLE_CAPABILITY",
          statusCode: 200,
        });
      },
    );
  });

  it("rejects a completion marker before stream metadata and finish reason", async () => {
    await withFakeServer(
      (_incoming, outgoing) => {
        outgoing.writeHead(200, { "content-type": "text/event-stream" });
        outgoing.end(": keepalive\n\ndata:[DONE]\n\n");
      },
      async (baseUrl) => {
        await expect(collect(provider(baseUrl).stream(baseRequest))).rejects.toMatchObject({
          code: "INTERRUPTED_STREAM",
        });
      },
    );
  });

  it.each([
    [
      "an overlong response id",
      [streamChunk({ id: "r".repeat(maximumProviderResponseIdLength + 1) }), "[DONE]"],
    ],
    [
      "an overlong model name",
      [streamChunk({ model: "m".repeat(maximumModelNameLength + 1) }), "[DONE]"],
    ],
    [
      "an overlong provider name",
      [streamChunk({ provider: "p".repeat(maximumProviderNameLength + 1) }), "[DONE]"],
    ],
    [
      "an overlong text delta",
      [streamChunk({ content: "c".repeat(maximumContentLength + 1) }), "[DONE]"],
    ],
    [
      "invalid token usage",
      [
        streamChunk(),
        streamChunk({
          content: null,
          choices: [],
          usage: {
            prompt_tokens: 8,
            completion_tokens: 2,
            prompt_tokens_details: { cached_tokens: 9 },
          },
        }),
        "[DONE]",
      ],
    ],
    ["an unknown finish reason", [streamChunk({ finishReason: "server_shutdown" }), "[DONE]"]],
  ])("rejects an SSE stream with %s", async (_label, events) => {
    await expectMalformedStream(events);
  });

  it("rejects cumulative streamed content above the content limit", async () => {
    await expectMalformedStream([
      streamChunk({ content: "a".repeat(600_000) }),
      streamChunk({ content: "b".repeat(400_001), finishReason: "stop" }),
      "[DONE]",
    ]);
  });

  it("rejects a single oversized SSE event before parsing it", async () => {
    await expectMalformedStream([
      streamChunk({ padding: "p".repeat(maximumSseEventBytes) }),
      "[DONE]",
    ]);
  });

  it("rejects an SSE stream whose cumulative wire bytes exceed the stream limit", async () => {
    const comment = `: ${"p".repeat(4_100_000)}\n\n`;
    const eventCount = Math.ceil(maximumSseStreamBytes / 4_100_000);
    await expectMalformedRawStream(comment.repeat(eventCount));
  });

  it.each([
    ["response id", { id: "different-response" }],
    ["provider name", { provider: "different-provider" }],
    ["model name", { model: "different-model" }],
  ])("rejects an SSE stream that changes its %s", async (_label, identityChange) => {
    await expectMalformedStream([
      streamChunk({ content: "first" }),
      streamChunk({ ...identityChange, content: "second", finishReason: "stop" }),
      "[DONE]",
    ]);
  });

  it("rejects choices emitted after the stream finish event", async () => {
    await expectMalformedStream([
      streamChunk({ content: "complete", finishReason: "stop" }),
      streamChunk({ content: "late" }),
      "[DONE]",
    ]);
  });

  it("rejects a duplicate stream finish event", async () => {
    await expectMalformedStream([
      streamChunk({ content: "complete", finishReason: "stop" }),
      streamChunk({ content: null, finishReason: "stop" }),
      "[DONE]",
    ]);
  });

  it("selects classifier and resolver models by purpose", async () => {
    const purposes = [
      ["classification", "qwen-classifier"],
      ["agent", "qwen-resolver"],
    ] as const;
    for (const [purpose, expectedModel] of purposes) {
      await withFakeServer(
        async (incoming, outgoing) => {
          await expect(readJsonRequest(incoming)).resolves.toMatchObject({
            model: expectedModel,
          });
          sendJson(outgoing, 200, completionResponse("ok"));
        },
        async (baseUrl) => {
          await provider(baseUrl).generate({ ...baseRequest, purpose });
        },
      );
    }
  });

  it("omits authorization for an explicitly unauthenticated local runtime", async () => {
    await withFakeServer(
      (incoming, outgoing) => {
        expect(incoming.headers.authorization).toBeUndefined();
        sendJson(outgoing, 200, completionResponse("ok"));
      },
      async (baseUrl) => {
        await provider(baseUrl, { apiKey: null }).generate(baseRequest);
      },
    );
  });

  it("normalizes an HTTP request timeout response", async () => {
    await expectHttpError(
      408,
      { error: { code: "request_timeout" } },
      { code: "TIMEOUT", retryable: true, statusCode: 408 },
    );
  });

  it("rejects an invalid structured capability before connecting", async () => {
    const invalidRequest: ModelRequest = {
      ...baseRequest,
      responseFormat: {
        name: "invalid name with spaces",
        schema: { type: "object" },
        strict: true,
      },
    };
    await expect(provider("http://127.0.0.1:1/v1").generate(invalidRequest)).rejects.toMatchObject({
      code: "INCOMPATIBLE_CAPABILITY",
    });
  });

  it("rejects JSON Schema features unsupported by local validation", async () => {
    await expect(
      provider("http://127.0.0.1:1/v1").generate({
        ...baseRequest,
        responseFormat: {
          name: "unsupported_schema",
          schema: { not: { type: "string" } },
          strict: true,
        },
      }),
    ).rejects.toMatchObject({ code: "INCOMPATIBLE_CAPABILITY", retryable: false });
  });

  it("rejects tool messages before making an incompatible request", async () => {
    const modelProvider = provider("http://127.0.0.1:1/v1");
    await expect(
      modelProvider.generate({
        ...baseRequest,
        messages: [{ role: "tool", content: "tool output" }],
      }),
    ).rejects.toMatchObject({ code: "INCOMPATIBLE_CAPABILITY", retryable: false });
  });
});

function provider(
  baseUrl: string,
  overrides: Partial<Omit<QwenVllmProviderConfiguration, "baseUrl">> = {},
): QwenVllmModelProvider {
  return new QwenVllmModelProvider({
    baseUrl: `${baseUrl}/v1`,
    ...baseConfiguration,
    ...overrides,
  });
}

interface CompletionEnvelopeOptions {
  readonly id?: string;
  readonly provider?: string;
  readonly model?: string;
  readonly content?: string | null;
  readonly finishReason?: string | null;
  readonly usage?: unknown;
  readonly padding?: string;
}

interface StreamChunkOptions {
  readonly id?: string;
  readonly provider?: string;
  readonly model?: string;
  readonly content?: string | null;
  readonly finishReason?: string | null;
  readonly choices?: readonly unknown[];
  readonly usage?: unknown;
  readonly padding?: string;
}

function completionResponse(content: string | null): unknown {
  return completionEnvelope({ content });
}

function completionEnvelope(options: CompletionEnvelopeOptions = {}): unknown {
  return {
    id: options.id ?? "chatcmpl-1",
    ...(options.provider === undefined ? {} : { provider: options.provider }),
    model: options.model ?? "Qwen/Qwen3-8B",
    choices: [
      {
        message: {
          role: "assistant",
          content: options.content === undefined ? "ok" : options.content,
        },
        finish_reason: options.finishReason === undefined ? "stop" : options.finishReason,
      },
    ],
    usage: options.usage ?? {
      prompt_tokens: 8,
      completion_tokens: 2,
      prompt_tokens_details: { cached_tokens: 3 },
    },
    ...(options.padding === undefined ? {} : { padding: options.padding }),
  };
}

function streamChunk(options: StreamChunkOptions = {}): unknown {
  return {
    id: options.id ?? "stream-response",
    ...(options.provider === undefined ? {} : { provider: options.provider }),
    model: options.model ?? "Qwen/Qwen3-8B",
    choices: options.choices ?? [
      {
        delta: {
          content: options.content === undefined ? "chunk" : options.content,
        },
        finish_reason: options.finishReason ?? null,
      },
    ],
    ...(options.usage === undefined ? {} : { usage: options.usage }),
    ...(options.padding === undefined ? {} : { padding: options.padding }),
  };
}

async function expectMalformedCompletion(responseBody: unknown): Promise<void> {
  await withFakeServer(
    (_incoming, outgoing) => {
      sendJson(outgoing, 200, responseBody);
    },
    async (baseUrl) => {
      await expect(
        provider(baseUrl, { requestTimeoutMs: 10_000 }).generate(baseRequest),
      ).rejects.toMatchObject({ code: "MALFORMED_RESPONSE", retryable: false });
    },
  );
}

async function expectMalformedStream(events: readonly unknown[]): Promise<void> {
  await withFakeServer(
    (_incoming, outgoing) => {
      outgoing.writeHead(200, { "content-type": "text/event-stream" });
      outgoing.end(
        events
          .map((event) => `data: ${event === "[DONE]" ? event : JSON.stringify(event)}\n\n`)
          .join(""),
      );
    },
    async (baseUrl) => {
      await expect(
        collect(provider(baseUrl, { requestTimeoutMs: 10_000 }).stream(baseRequest)),
      ).rejects.toMatchObject({ code: "MALFORMED_RESPONSE", retryable: false });
    },
  );
}

async function expectMalformedRawStream(rawStream: string): Promise<void> {
  await withFakeServer(
    (_incoming, outgoing) => {
      outgoing.writeHead(200, { "content-type": "text/event-stream" });
      outgoing.end(rawStream);
    },
    async (baseUrl) => {
      await expect(
        collect(provider(baseUrl, { requestTimeoutMs: 10_000 }).stream(baseRequest)),
      ).rejects.toMatchObject({ code: "MALFORMED_RESPONSE", retryable: false });
    },
  );
}

async function expectHttpError(
  statusCode: number,
  responseBody: unknown,
  expected: Readonly<Record<string, unknown>>,
): Promise<void> {
  await withFakeServer(
    (_incoming, outgoing) => {
      if (typeof responseBody === "string") {
        outgoing.writeHead(statusCode, { "content-type": "text/plain" });
        outgoing.end(responseBody);
      } else {
        sendJson(outgoing, statusCode, responseBody);
      }
    },
    async (baseUrl) => {
      await expect(provider(baseUrl).generate(baseRequest)).rejects.toMatchObject(expected);
    },
  );
}

async function collect(
  events: AsyncIterable<ModelStreamEvent>,
): Promise<readonly ModelStreamEvent[]> {
  const collected: ModelStreamEvent[] = [];
  for await (const event of events) {
    collected.push(event);
  }
  return collected;
}

async function readJsonRequest(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    if (!Buffer.isBuffer(chunk)) {
      throw new TypeError("Expected an HTTP request buffer.");
    }
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
}

function sendJson(response: ServerResponse, statusCode: number, body: unknown): void {
  response.writeHead(statusCode, { "content-type": "application/json" });
  response.end(JSON.stringify(body));
}

async function withFakeServer(
  handler: FakeServerHandler,
  assertion: (baseUrl: string) => Promise<void>,
): Promise<void> {
  const server = await startFakeServer(handler);
  try {
    await assertion(server.baseUrl);
  } finally {
    await server.close();
  }
}

async function startFakeServer(handler: FakeServerHandler): Promise<RunningFakeServer> {
  const server = createServer((request, response) => {
    void Promise.resolve(handler(request, response)).catch((error: unknown) => {
      response.destroy(error instanceof Error ? error : new Error("Fake server failed."));
    });
  });
  await listen(server);
  const address = server.address();
  if (address === null || typeof address === "string") {
    throw new Error("Fake server did not bind a TCP port.");
  }
  return {
    baseUrl: `http://127.0.0.1:${address.port.toString()}`,
    async close(): Promise<void> {
      server.closeAllConnections();
      if (!server.listening) {
        return;
      }
      await new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error === undefined) {
            resolve();
          } else {
            reject(error);
          }
        });
      });
    },
  };
}

async function listen(server: Server): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const onError = (error: Error): void => {
      server.removeListener("listening", onListening);
      reject(error);
    };
    const onListening = (): void => {
      server.removeListener("error", onError);
      resolve();
    };
    server.once("error", onError);
    server.once("listening", onListening);
    server.listen(0, "127.0.0.1");
  });
}
