import { z } from "zod";

const maximumTimeoutMilliseconds = 10 * 60 * 1_000;
const modelNameSchema = z.string().trim().min(1).max(200);
const apiKeySchema = z
  .string()
  .max(4_096)
  .refine((value) => value === "" || /^[\x21-\x7e]+$/.test(value));
const timeoutSchema = z
  .string()
  .regex(/^[1-9]\d*$/)
  .transform((value) => Number(value))
  .pipe(z.number().int().min(1).max(maximumTimeoutMilliseconds));

const environmentSchema = z.object({
  MODEL_BASE_URL: z.string().trim().min(1),
  MODEL_API_KEY: apiKeySchema.optional().default(""),
  MODEL_CHAT_MODEL: modelNameSchema,
  MODEL_EXTRACTOR_MODEL: modelNameSchema,
  MODEL_CLASSIFIER_MODEL: modelNameSchema,
  MODEL_RESOLVER_MODEL: modelNameSchema,
  MODEL_REQUEST_TIMEOUT_MS: timeoutSchema,
});

const providerConfigurationSchema = z.object({
  baseUrl: z.string().trim().min(1),
  apiKey: apiKeySchema.nullable(),
  chatModel: modelNameSchema,
  extractorModel: modelNameSchema,
  classifierModel: modelNameSchema,
  resolverModel: modelNameSchema,
  requestTimeoutMs: z.number().int().min(1).max(maximumTimeoutMilliseconds),
});

export type ModelProviderEnvironment = Readonly<Record<string, string | undefined>>;

export interface QwenVllmProviderConfiguration {
  readonly baseUrl: string;
  readonly apiKey: string | null;
  readonly chatModel: string;
  readonly extractorModel: string;
  readonly classifierModel: string;
  readonly resolverModel: string;
  readonly requestTimeoutMs: number;
}

export class ModelProviderConfigurationError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "ModelProviderConfigurationError";
  }
}

export function loadQwenVllmProviderConfiguration(
  environment: ModelProviderEnvironment,
): QwenVllmProviderConfiguration {
  const result = environmentSchema.safeParse(environment);
  if (!result.success) {
    throw configurationError(result.error.issues);
  }

  return validateQwenVllmProviderConfiguration({
    baseUrl: result.data.MODEL_BASE_URL,
    apiKey: result.data.MODEL_API_KEY === "" ? null : result.data.MODEL_API_KEY,
    chatModel: result.data.MODEL_CHAT_MODEL,
    extractorModel: result.data.MODEL_EXTRACTOR_MODEL,
    classifierModel: result.data.MODEL_CLASSIFIER_MODEL,
    resolverModel: result.data.MODEL_RESOLVER_MODEL,
    requestTimeoutMs: result.data.MODEL_REQUEST_TIMEOUT_MS,
  });
}

export function validateQwenVllmProviderConfiguration(
  configuration: QwenVllmProviderConfiguration,
): QwenVllmProviderConfiguration {
  const result = providerConfigurationSchema.safeParse(configuration);
  if (!result.success) {
    throw configurationError(result.error.issues);
  }

  return {
    ...result.data,
    baseUrl: normalizeBaseUrl(result.data.baseUrl),
  };
}

function normalizeBaseUrl(value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new ModelProviderConfigurationError(
      "Invalid model provider configuration: baseUrl must be an absolute HTTP(S) URL.",
    );
  }

  if (
    (url.protocol !== "http:" && url.protocol !== "https:") ||
    url.username !== "" ||
    url.password !== "" ||
    url.search !== "" ||
    url.hash !== ""
  ) {
    throw new ModelProviderConfigurationError(
      "Invalid model provider configuration: baseUrl must be an HTTP(S) URL without credentials, query, or fragment.",
    );
  }

  const pathname = url.pathname.replace(/\/+$/, "");
  url.pathname = pathname === "" ? "/" : pathname;
  const normalized = url.toString().replace(/\/$/, "");
  return normalized;
}

function configurationError(issues: readonly z.core.$ZodIssue[]): ModelProviderConfigurationError {
  const fields = [
    ...new Set(
      issues.map((issue) => {
        const firstPathSegment = issue.path[0];
        return typeof firstPathSegment === "string" ? firstPathSegment : "configuration";
      }),
    ),
  ];
  return new ModelProviderConfigurationError(
    `Invalid model provider configuration: ${fields.join(", ")}.`,
  );
}
