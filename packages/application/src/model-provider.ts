import type { JsonValue } from "@cce/shared";

export type ModelProfile = "small" | "medium" | "large";
export type ModelPurpose = "chat" | "extraction" | "classification" | "agent";

export interface ModelMessage {
  readonly role: "system" | "user" | "assistant" | "tool";
  readonly content: string;
}

export interface StructuredResponseFormat {
  readonly name: string;
  readonly schema: JsonValue;
  readonly strict: true;
}

export interface ModelRequest {
  readonly profile: ModelProfile;
  readonly purpose: ModelPurpose;
  readonly messages: readonly ModelMessage[];
  readonly promptId: string;
  readonly promptVersion: number;
  readonly temperature: number;
  readonly responseFormat: StructuredResponseFormat | null;
  readonly signal?: AbortSignal;
}

export interface ModelUsage {
  readonly inputTokens: number;
  readonly cachedTokens: number;
  readonly outputTokens: number;
}

export interface ModelResponse {
  readonly providerResponseId: string;
  readonly provider: string;
  readonly model: string;
  readonly content: string;
  readonly finishReason: "stop" | "length" | "content_filter" | "tool_call" | "unknown";
  readonly usage: ModelUsage;
}

export type ModelStreamEvent =
  | {
      readonly type: "start";
      readonly providerResponseId: string;
      readonly provider: string;
      readonly model: string;
    }
  | { readonly type: "text_delta"; readonly text: string }
  | { readonly type: "usage"; readonly usage: ModelUsage }
  | { readonly type: "finish"; readonly finishReason: ModelResponse["finishReason"] };

export interface ModelProvider {
  generate(request: ModelRequest): Promise<ModelResponse>;
  stream(request: ModelRequest): AsyncIterable<ModelStreamEvent>;
}

export type ModelProviderErrorCode =
  | "AUTHENTICATION"
  | "RATE_LIMIT"
  | "TIMEOUT"
  | "CONNECTION"
  | "SERVER"
  | "MODEL_UNAVAILABLE"
  | "MALFORMED_RESPONSE"
  | "INTERRUPTED_STREAM"
  | "INCOMPATIBLE_CAPABILITY";

export class ModelProviderError extends Error {
  public readonly code: ModelProviderErrorCode;
  public readonly retryable: boolean;
  public readonly statusCode: number | null;

  public constructor(
    code: ModelProviderErrorCode,
    message: string,
    options: { readonly retryable: boolean; readonly statusCode?: number | null },
  ) {
    super(message);
    this.name = "ModelProviderError";
    this.code = code;
    this.retryable = options.retryable;
    this.statusCode = options.statusCode ?? null;
  }
}
