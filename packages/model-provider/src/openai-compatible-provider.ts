import { ModelProviderError } from "@cce/application";
import type {
  ModelMessage,
  ModelProvider,
  ModelRequest,
  ModelResponse,
  ModelStreamEvent,
  ModelUsage,
  StructuredResponseFormat,
} from "@cce/application";
import { z } from "zod";

import {
  validateQwenVllmProviderConfiguration,
  type QwenVllmProviderConfiguration,
} from "./configuration";

const providerName = "qwen-vllm";
const maximumInt32 = 2_147_483_647;
const maximumProviderResponseIdLength = 500;
const maximumProviderNameLength = 100;
const maximumModelNameLength = 200;
const maximumContentLength = 1_000_000;
const maximumCompletionBodyBytes = 8_000_000;
const maximumErrorBodyBytes = 65_536;
const maximumSseEventBytes = 8_000_000;
const maximumSseStreamBytes = 16_000_000;

const tokenCountSchema = z.number().int().min(0).max(maximumInt32);
const finishReasonSchema = z.enum([
  "stop",
  "length",
  "content_filter",
  "tool_calls",
  "function_call",
]);

const usageSchema = z
  .object({
    prompt_tokens: tokenCountSchema,
    completion_tokens: tokenCountSchema,
    prompt_tokens_details: z
      .object({ cached_tokens: tokenCountSchema.optional() })
      .passthrough()
      .optional(),
  })
  .passthrough()
  .superRefine((usage, context) => {
    const cachedTokens = usage.prompt_tokens_details?.cached_tokens ?? 0;
    if (cachedTokens > usage.prompt_tokens) {
      context.addIssue({
        code: "custom",
        path: ["prompt_tokens_details", "cached_tokens"],
        message: "Cached tokens cannot exceed prompt tokens.",
      });
    }
  });

const providerIdentitySchema = z.object({
  providerResponseId: z.string().min(1).max(maximumProviderResponseIdLength),
  provider: z.string().min(1).max(maximumProviderNameLength),
  model: z.string().min(1).max(maximumModelNameLength),
});

const completionSchema = z
  .object({
    id: z.string().min(1).max(maximumProviderResponseIdLength),
    provider: z.string().min(1).max(maximumProviderNameLength).optional(),
    model: z.string().min(1).max(maximumModelNameLength),
    choices: z
      .array(
        z
          .object({
            message: z
              .object({
                content: z.string().max(maximumContentLength).nullish(),
              })
              .passthrough(),
            finish_reason: finishReasonSchema,
          })
          .passthrough(),
      )
      .length(1),
    usage: usageSchema,
  })
  .passthrough();

const streamChunkSchema = z
  .object({
    id: z.string().min(1).max(maximumProviderResponseIdLength).optional(),
    provider: z.string().min(1).max(maximumProviderNameLength).optional(),
    model: z.string().min(1).max(maximumModelNameLength).optional(),
    choices: z
      .array(
        z
          .object({
            delta: z
              .object({
                content: z.string().max(maximumContentLength).nullable().optional(),
              })
              .passthrough(),
            finish_reason: finishReasonSchema.nullable().optional(),
          })
          .passthrough(),
      )
      .max(1),
    usage: usageSchema.nullable().optional(),
  })
  .passthrough();

const providerErrorSchema = z
  .object({
    error: z
      .object({
        code: z.union([z.string(), z.number()]).nullish(),
        type: z.string().nullish(),
        param: z.string().nullable().optional(),
        message: z.string().optional(),
      })
      .passthrough(),
  })
  .passthrough();

const modelMessageSchema = z.object({
  role: z.enum(["system", "user", "assistant", "tool"]),
  content: z.string(),
});

const structuredResponseFormatSchema = z.object({
  name: z.string().regex(/^[A-Za-z0-9_-]{1,64}$/),
  schema: z.record(z.string(), z.json()),
  strict: z.literal(true),
});

interface OpenAiRequestBody {
  readonly model: string;
  readonly messages: readonly ModelMessage[];
  readonly temperature: number;
  readonly stream: boolean;
  readonly stream_options?: { readonly include_usage: true };
  readonly response_format?:
    | { readonly type: "json_schema"; readonly json_schema: StructuredResponseFormat }
    | { readonly type: "json_object" };
}

interface ErrorDetails {
  readonly code: string;
  readonly type: string;
  readonly param: string;
  readonly message: string;
}

interface StructuredOutputDiagnostics {
  readonly responseCharacterLength: number;
  readonly topLevelKeys: readonly string[];
  readonly issues: readonly { readonly code: string; readonly path: readonly PropertyKey[] }[];
}

class RequestDeadline {
  readonly #controller = new AbortController();
  readonly #timeout: NodeJS.Timeout;
  readonly #callerSignal: AbortSignal | undefined;
  #timedOut = false;
  #callerAborted = false;

  public constructor(timeoutMilliseconds: number, callerSignal: AbortSignal | undefined) {
    this.#callerSignal = callerSignal;
    this.#timeout = setTimeout(() => {
      this.#timedOut = true;
      this.#controller.abort();
    }, timeoutMilliseconds);
    this.#timeout.unref();

    if (callerSignal?.aborted === true) {
      this.abortFromCaller();
    } else {
      callerSignal?.addEventListener("abort", this.abortFromCaller, { once: true });
    }
  }

  public get signal(): AbortSignal {
    return this.#controller.signal;
  }

  public get timedOut(): boolean {
    return this.#timedOut;
  }

  public get callerAborted(): boolean {
    return this.#callerAborted;
  }

  public dispose(): void {
    clearTimeout(this.#timeout);
    this.#callerSignal?.removeEventListener("abort", this.abortFromCaller);
  }

  private readonly abortFromCaller = (): void => {
    this.#callerAborted = true;
    this.#controller.abort();
  };
}

export class QwenVllmModelProvider implements ModelProvider {
  readonly #configuration: QwenVllmProviderConfiguration;
  readonly #completionEndpoint: string;

  public constructor(configuration: QwenVllmProviderConfiguration) {
    this.#configuration = validateQwenVllmProviderConfiguration(configuration);
    this.#completionEndpoint = `${this.#configuration.baseUrl}/chat/completions`;
  }

  public async generate(request: ModelRequest): Promise<ModelResponse> {
    const structuredResponseSchema = validateRequest(request);
    const deadline = new RequestDeadline(this.#configuration.requestTimeoutMs, request.signal);
    let response: Response | null = null;
    let errorDetails: ErrorDetails | null = null;
    const diagnostics: { output: StructuredOutputDiagnostics | null } = { output: null };
    try {
      response = await this.sendRequest(this.buildRequestBody(request, false), deadline);
      if (!response.ok) {
        errorDetails = await readErrorDetails(response);
        throw normalizeHttpError(response.status, errorDetails);
      }
      const payload = await readJson(response);
      const completion = completionSchema.safeParse(payload);
      if (!completion.success) {
        throw malformedResponse("Model provider returned an invalid completion response.");
      }

      const choice = completion.data.choices[0];
      if (
        choice?.message.content === undefined ||
        choice.message.content === null ||
        (structuredResponseSchema !== null && choice.message.content.trim() === "")
      ) {
        throw malformedResponse("Model provider returned a completion without text content.");
      }
      const identity = validateProviderIdentity(
        completion.data.id,
        completion.data.model,
        completion.data.provider,
      );
      if (structuredResponseSchema !== null) {
        const content = choice.message.content;
        assertStructuredJson(content, structuredResponseSchema, (value, issues) => {
          diagnostics.output = {
            responseCharacterLength: content.length,
            topLevelKeys:
              value !== null && typeof value === "object" ? Object.keys(value).slice(0, 20) : [],
            issues: issues.slice(0, 20).map(({ code, path }) => ({ code, path })),
          };
        });
      }

      return {
        ...identity,
        content: choice.message.content,
        finishReason: normalizeFinishReason(choice.finish_reason),
        usage: normalizeUsage(completion.data.usage),
      };
    } catch (error) {
      const normalized = normalizeRequestFailure(error, deadline, "generate");
      if (
        request.purpose === "extraction" &&
        (process.env["NODE_ENV"] === "development" || process.env["NODE_ENV"] === "test")
      ) {
        const safe = (text: string): string =>
          safeDiagnosticText(text, this.#configuration, request);
        console.error("Model extraction provider failed", {
          name: safe(normalized.name),
          message: safe(normalized.message),
          code: normalized instanceof ModelProviderError ? normalized.code : null,
          status: response?.status ?? null,
          requestId: safe(response?.headers.get("x-request-id") ?? "") || null,
          model: safe(this.modelForPurpose(request)),
          baseUrl: safe(this.#configuration.baseUrl),
          requestError:
            error instanceof Error
              ? { name: safe(error.name), message: safe(error.message) }
              : null,
          providerError:
            errorDetails === null
              ? null
              : {
                  code: safe(errorDetails.code),
                  type: safe(errorDetails.type),
                  param: safe(errorDetails.param),
                  message: safe(errorDetails.message),
                },
          output:
            diagnostics.output === null
              ? null
              : {
                  responseCharacterLength: diagnostics.output.responseCharacterLength,
                  topLevelKeys: diagnostics.output.topLevelKeys.map(safe),
                  issues: diagnostics.output.issues.map(({ code, path }) => ({
                    code,
                    path: path.map((part) =>
                      typeof part === "number" ? part : safe(String(part)),
                    ),
                  })),
                },
        });
      }
      throw normalized;
    } finally {
      deadline.dispose();
    }
  }

  public async *stream(request: ModelRequest): AsyncIterable<ModelStreamEvent> {
    const structuredResponseSchema = validateRequest(request);
    const deadline = new RequestDeadline(this.#configuration.requestTimeoutMs, request.signal);
    try {
      const response = await this.sendRequest(this.buildRequestBody(request, true), deadline);
      if (!response.ok) {
        throw normalizeHttpError(response.status, await readErrorDetails(response));
      }
      const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
      if (!contentType.includes("text/event-stream")) {
        throw new ModelProviderError(
          "INCOMPATIBLE_CAPABILITY",
          "Model provider did not return an SSE stream.",
          { retryable: false, statusCode: response.status },
        );
      }
      if (response.body === null) {
        throw malformedResponse("Model provider returned an empty stream body.");
      }

      let identity: z.infer<typeof providerIdentitySchema> | null = null;
      let finishReason: ModelResponse["finishReason"] | null = null;
      let structuredContent = "";
      for await (const data of readSseData(response.body)) {
        if (data === "[DONE]") {
          if (identity === null || finishReason === null) {
            throw interruptedStream();
          }
          if (structuredResponseSchema !== null) {
            assertStructuredJson(structuredContent, structuredResponseSchema);
          }
          yield { type: "finish", finishReason };
          return;
        }

        const chunk = parseStreamChunk(data);
        if (identity === null) {
          if (chunk.id === undefined || chunk.model === undefined) {
            throw malformedResponse("Model provider stream did not identify its response.");
          }
          identity = validateProviderIdentity(chunk.id, chunk.model, chunk.provider);
          yield { type: "start", ...identity };
        } else {
          assertConsistentStreamIdentity(chunk, identity);
        }

        const choice = chunk.choices[0];
        if (finishReason !== null && choice !== undefined) {
          throw malformedResponse("Model provider stream emitted a choice after finishing.");
        }
        const content = choice?.delta.content;
        if (content !== undefined && content !== null && content !== "") {
          if (structuredContent.length + content.length > maximumContentLength) {
            throw malformedResponse("Model provider stream exceeded the content limit.");
          }
          structuredContent += content;
          yield { type: "text_delta", text: content };
        }
        if (choice?.finish_reason !== undefined && choice.finish_reason !== null) {
          const nextFinishReason = normalizeFinishReason(choice.finish_reason);
          finishReason = nextFinishReason;
        }
        if (chunk.usage !== undefined && chunk.usage !== null) {
          yield { type: "usage", usage: normalizeUsage(chunk.usage) };
        }
      }

      throw interruptedStream();
    } catch (error) {
      throw normalizeRequestFailure(error, deadline, "stream");
    } finally {
      deadline.dispose();
    }
  }

  private buildRequestBody(request: ModelRequest, stream: boolean): OpenAiRequestBody {
    // DeepSeek chat completions supports JSON objects, not OpenAI JSON Schema output.
    const jsonObjectExtraction =
      request.purpose === "extraction" &&
      request.responseFormat !== null &&
      new URL(this.#configuration.baseUrl).hostname === "api.deepseek.com";
    const responseFormat =
      request.responseFormat === null
        ? {}
        : jsonObjectExtraction
          ? { response_format: { type: "json_object" as const } }
          : {
              response_format: {
                type: "json_schema" as const,
                json_schema: request.responseFormat,
              },
            };
    const streamOptions = stream ? { stream_options: { include_usage: true as const } } : {};
    return {
      model: this.modelForPurpose(request),
      messages:
        jsonObjectExtraction && request.responseFormat !== null
          ? [
              {
                role: "system",
                content: `Return JSON only matching this JSON Schema: ${JSON.stringify(request.responseFormat.schema)}`,
              },
              ...request.messages,
            ]
          : request.messages,
      temperature: request.temperature,
      stream,
      ...streamOptions,
      ...responseFormat,
    };
  }

  private modelForPurpose(request: ModelRequest): string {
    switch (request.purpose) {
      case "chat":
        return this.#configuration.chatModel;
      case "extraction":
        return this.#configuration.extractorModel;
      case "classification":
        return this.#configuration.classifierModel;
      case "agent":
        return this.#configuration.resolverModel;
    }
  }

  private async sendRequest(body: OpenAiRequestBody, deadline: RequestDeadline): Promise<Response> {
    const headers = new Headers({
      accept: body.stream ? "text/event-stream" : "application/json",
      "content-type": "application/json",
    });
    if (this.#configuration.apiKey !== null) {
      headers.set("authorization", `Bearer ${this.#configuration.apiKey}`);
    }

    return fetch(this.#completionEndpoint, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal: deadline.signal,
    });
  }
}

function validateRequest(request: ModelRequest): z.ZodType | null {
  if (
    request.messages.length === 0 ||
    !Number.isFinite(request.temperature) ||
    request.temperature < 0 ||
    request.temperature > 2 ||
    request.promptId.trim() === "" ||
    !Number.isInteger(request.promptVersion) ||
    request.promptVersion < 1
  ) {
    throw new TypeError("Invalid model request.");
  }
  for (const message of request.messages) {
    if (!modelMessageSchema.safeParse(message).success) {
      throw new TypeError("Invalid model message.");
    }
    if (message.role === "tool") {
      throw new ModelProviderError(
        "INCOMPATIBLE_CAPABILITY",
        "Tool messages require tool-call provenance that is not represented by this provider port.",
        { retryable: false },
      );
    }
  }
  if (request.responseFormat === null) {
    return null;
  }
  const responseFormat = structuredResponseFormatSchema.safeParse(request.responseFormat);
  if (!responseFormat.success) {
    throw new ModelProviderError(
      "INCOMPATIBLE_CAPABILITY",
      "The requested structured response format is not supported.",
      { retryable: false },
    );
  }
  try {
    return z.fromJSONSchema(responseFormat.data.schema);
  } catch {
    throw new ModelProviderError(
      "INCOMPATIBLE_CAPABILITY",
      "The requested JSON Schema uses unsupported features.",
      { retryable: false },
    );
  }
}

async function readJson(response: Response): Promise<unknown> {
  let body: BoundedText;
  try {
    body = await readBoundedResponseText(response, maximumCompletionBodyBytes);
  } catch (error) {
    if (error instanceof ModelProviderError) {
      throw error;
    }
    throw new ModelProviderError("CONNECTION", "Model provider response was interrupted.", {
      retryable: true,
      statusCode: response.status,
    });
  }
  if (body.exceeded) {
    throw malformedResponse(
      "Model provider completion response exceeded the byte limit.",
      response.status,
    );
  }
  try {
    return JSON.parse(body.text) as unknown;
  } catch {
    throw malformedResponse("Model provider returned malformed JSON.", response.status);
  }
}

interface BoundedText {
  readonly text: string;
  readonly exceeded: boolean;
}

async function readBoundedResponseText(
  response: Response,
  maximumBytes: number,
): Promise<BoundedText> {
  const declaredLength = response.headers.get("content-length");
  if (
    declaredLength !== null &&
    /^\d+$/.test(declaredLength) &&
    Number(declaredLength) > maximumBytes
  ) {
    await response.body?.cancel().catch(() => undefined);
    return { text: "", exceeded: true };
  }
  if (response.body === null) {
    return { text: "", exceeded: false };
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const fragments: string[] = [];
  let bytesRead = 0;
  let completed = false;
  try {
    while (true) {
      const result = await reader.read();
      if (result.done) {
        fragments.push(decoder.decode());
        completed = true;
        return { text: fragments.join(""), exceeded: false };
      }
      const chunk: unknown = result.value;
      if (!(chunk instanceof Uint8Array)) {
        throw malformedResponse("Model provider returned an invalid response body chunk.");
      }
      bytesRead += chunk.byteLength;
      if (bytesRead > maximumBytes) {
        return { text: "", exceeded: true };
      }
      fragments.push(decoder.decode(chunk, { stream: true }));
    }
  } finally {
    if (!completed) {
      await reader.cancel().catch(() => undefined);
    }
    reader.releaseLock();
  }
}

function parseStreamChunk(data: string): z.infer<typeof streamChunkSchema> {
  let payload: unknown;
  try {
    payload = JSON.parse(data) as unknown;
  } catch {
    throw malformedResponse("Model provider stream contained malformed JSON.");
  }
  const result = streamChunkSchema.safeParse(payload);
  if (!result.success) {
    throw malformedResponse("Model provider stream contained an invalid event.");
  }
  return result.data;
}

function validateProviderIdentity(
  providerResponseId: string,
  model: string,
  reportedProvider: string | undefined,
): z.infer<typeof providerIdentitySchema> {
  if (reportedProvider !== undefined && reportedProvider !== providerName) {
    throw malformedResponse("Model provider returned inconsistent provider identity metadata.");
  }
  const result = providerIdentitySchema.safeParse({
    providerResponseId,
    provider: providerName,
    model,
  });
  if (!result.success) {
    throw malformedResponse("Model provider returned invalid response identity metadata.");
  }
  return result.data;
}

function assertConsistentStreamIdentity(
  chunk: z.infer<typeof streamChunkSchema>,
  identity: z.infer<typeof providerIdentitySchema>,
): void {
  if (
    (chunk.id !== undefined && chunk.id !== identity.providerResponseId) ||
    (chunk.provider !== undefined && chunk.provider !== identity.provider) ||
    (chunk.model !== undefined && chunk.model !== identity.model)
  ) {
    throw malformedResponse("Model provider stream changed its response identity.");
  }
}

async function* readSseData(body: ReadableStream<Uint8Array>): AsyncIterable<string> {
  const reader = body.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });
  const encoder = new TextEncoder();
  let buffer = "";
  let bufferBytes = 0;
  let totalBytes = 0;
  let completed = false;
  try {
    while (true) {
      const result = await reader.read();
      if (result.done) {
        buffer += decodeSseBytes(decoder);
        completed = true;
        break;
      }
      totalBytes += result.value.byteLength;
      if (totalBytes > maximumSseStreamBytes) {
        throw malformedResponse("Model provider SSE stream exceeded the byte limit.");
      }
      bufferBytes += result.value.byteLength;
      buffer += decodeSseBytes(decoder, result.value);
      let boundary = findEventBoundary(buffer);
      while (boundary !== null) {
        const eventBlock = buffer.slice(0, boundary.index);
        const consumedText = buffer.slice(0, boundary.index + boundary.length);
        const consumedBytes = encoder.encode(consumedText).byteLength;
        if (consumedBytes > maximumSseEventBytes) {
          throw malformedResponse("Model provider SSE event exceeded the byte limit.");
        }
        if (consumedBytes > bufferBytes) {
          throw malformedResponse("Model provider SSE stream contained invalid UTF-8 framing.");
        }
        buffer = buffer.slice(boundary.index + boundary.length);
        bufferBytes -= consumedBytes;
        const data = dataFromEventBlock(eventBlock);
        if (data !== null) {
          yield data;
        }
        boundary = findEventBoundary(buffer);
      }
      if (bufferBytes > maximumSseEventBytes) {
        throw malformedResponse("Model provider SSE event exceeded the byte limit.");
      }
    }
    if (buffer.trim() !== "") {
      throw interruptedStream();
    }
  } finally {
    if (!completed) {
      await reader.cancel().catch(() => undefined);
    }
    reader.releaseLock();
  }
}

function decodeSseBytes(decoder: InstanceType<typeof TextDecoder>, bytes?: Uint8Array): string {
  try {
    return bytes === undefined ? decoder.decode() : decoder.decode(bytes, { stream: true });
  } catch {
    throw malformedResponse("Model provider SSE stream contained invalid UTF-8.");
  }
}

function findEventBoundary(
  buffer: string,
): { readonly index: number; readonly length: number } | null {
  const match = /\r?\n\r?\n/.exec(buffer);
  return match === null ? null : { index: match.index, length: match[0].length };
}

function dataFromEventBlock(block: string): string | null {
  const dataLines: string[] = [];
  for (const line of block.split(/\r?\n/)) {
    if (line.startsWith("data:")) {
      const value = line.slice("data:".length);
      dataLines.push(value.startsWith(" ") ? value.slice(1) : value);
    }
  }
  return dataLines.length === 0 ? null : dataLines.join("\n");
}

function normalizeHttpError(statusCode: number, details: ErrorDetails): ModelProviderError {
  if (statusCode === 401 || statusCode === 403) {
    return new ModelProviderError("AUTHENTICATION", "Model provider authentication failed.", {
      retryable: false,
      statusCode,
    });
  }
  if (statusCode === 408) {
    return new ModelProviderError("TIMEOUT", "Model provider timed out the request.", {
      retryable: true,
      statusCode,
    });
  }
  if (statusCode === 429) {
    return new ModelProviderError("RATE_LIMIT", "Model provider rate limit was exceeded.", {
      retryable: true,
      statusCode,
    });
  }
  if (isUnavailableModel(details)) {
    return new ModelProviderError("MODEL_UNAVAILABLE", "Configured model is unavailable.", {
      retryable: statusCode >= 500,
      statusCode,
    });
  }
  if (isIncompatibleCapability(details) || [400, 404, 405, 409, 415, 422].includes(statusCode)) {
    return new ModelProviderError(
      "INCOMPATIBLE_CAPABILITY",
      "Model provider rejected a requested capability.",
      { retryable: false, statusCode },
    );
  }
  return new ModelProviderError("SERVER", "Model provider returned a server error.", {
    retryable: statusCode >= 500,
    statusCode,
  });
}

async function readErrorDetails(response: Response): Promise<ErrorDetails> {
  let body: BoundedText;
  try {
    body = await readBoundedResponseText(response, maximumErrorBodyBytes);
  } catch {
    return { code: "", type: "", param: "", message: "" };
  }
  if (body.exceeded) {
    return { code: "", type: "", param: "", message: "" };
  }
  let payload: unknown;
  try {
    payload = JSON.parse(body.text) as unknown;
  } catch {
    return { code: "", type: "", param: "", message: "" };
  }
  const result = providerErrorSchema.safeParse(payload);
  if (!result.success) {
    return { code: "", type: "", param: "", message: "" };
  }
  return {
    code: String(result.data.error.code ?? ""),
    type: result.data.error.type ?? "",
    param: result.data.error.param ?? "",
    message: result.data.error.message ?? "",
  };
}

function isUnavailableModel(details: ErrorDetails): boolean {
  const fingerprint = `${details.code} ${details.type} ${details.message}`.toLowerCase();
  return (
    /model[_ -]?(not[_ -]?found|unavailable)/.test(fingerprint) ||
    /model .* (does not exist|is not available|is unavailable|was not found)/.test(fingerprint)
  );
}

function isIncompatibleCapability(details: ErrorDetails): boolean {
  const fingerprint =
    `${details.code} ${details.type} ${details.param} ${details.message}`.toLowerCase();
  return (
    /(unsupported|not supported|not implemented|unknown parameter)/.test(fingerprint) &&
    /(response.format|json.schema|stream|tool|capability)/.test(fingerprint)
  );
}

function normalizeRequestFailure(
  error: unknown,
  deadline: RequestDeadline,
  operation: "generate" | "stream",
): Error {
  if (deadline.timedOut) {
    return new ModelProviderError("TIMEOUT", "Model provider request timed out.", {
      retryable: true,
    });
  }
  if (deadline.callerAborted) {
    return new ModelProviderError(
      operation === "stream" ? "INTERRUPTED_STREAM" : "TIMEOUT",
      operation === "stream"
        ? "Model provider stream was cancelled."
        : "Model provider request was cancelled.",
      { retryable: false },
    );
  }
  if (error instanceof ModelProviderError) {
    return error;
  }
  if (operation === "stream") {
    return interruptedStream();
  }
  return new ModelProviderError("CONNECTION", "Could not connect to the model provider.", {
    retryable: true,
  });
}

function normalizeUsage(usage: z.infer<typeof usageSchema>): ModelUsage {
  return {
    inputTokens: usage.prompt_tokens,
    cachedTokens: usage.prompt_tokens_details?.cached_tokens ?? 0,
    outputTokens: usage.completion_tokens,
  };
}

function normalizeFinishReason(
  value: z.infer<typeof finishReasonSchema>,
): ModelResponse["finishReason"] {
  switch (value) {
    case "stop":
      return "stop";
    case "length":
      return "length";
    case "content_filter":
      return "content_filter";
    case "tool_calls":
    case "function_call":
      return "tool_call";
  }
}

function assertStructuredJson(
  content: string,
  schema: z.ZodType,
  onInvalid?: (value: unknown, issues: readonly z.core.$ZodIssue[]) => void,
): void {
  let value: unknown;
  try {
    value = JSON.parse(content) as unknown;
  } catch {
    onInvalid?.(undefined, []);
    throw malformedResponse("Model provider returned malformed structured output.");
  }
  const result = schema.safeParse(value);
  if (!result.success) {
    onInvalid?.(value, result.error.issues);
    throw malformedResponse("Model provider returned structured output that violated its schema.");
  }
}

function safeDiagnosticText(
  text: string,
  configuration: QwenVllmProviderConfiguration,
  request: ModelRequest,
): string {
  let safe =
    configuration.apiKey === null || configuration.apiKey === ""
      ? text
      : text.replaceAll(configuration.apiKey, "[REDACTED]");
  for (const message of request.messages) {
    if (message.content !== "") {
      safe = safe
        .replaceAll(message.content, "[REDACTED MESSAGE]")
        .replaceAll(JSON.stringify(message.content).slice(1, -1), "[REDACTED MESSAGE]");
    }
  }
  if (
    /\b(?:authorization|cookie|set-cookie|api[_-]?key|session[_-]?secret|password)\b["']?\s*[:=]|\bBearer\s+|:\/\/[^\s/]+@/i.test(
      safe,
    )
  ) {
    return "[REDACTED SENSITIVE DIAGNOSTIC]";
  }
  return safe.replace(/[\r\n\t]/g, " ").slice(0, 1_000);
}

function malformedResponse(message: string, statusCode: number | null = null): ModelProviderError {
  return new ModelProviderError("MALFORMED_RESPONSE", message, {
    retryable: false,
    statusCode,
  });
}

function interruptedStream(): ModelProviderError {
  return new ModelProviderError(
    "INTERRUPTED_STREAM",
    "Model provider stream ended before its completion marker.",
    { retryable: true },
  );
}
