import { describe, expect, it } from "vitest";

import {
  loadQwenVllmProviderConfiguration,
  ModelProviderConfigurationError,
} from "./configuration";

const validEnvironment = {
  MODEL_BASE_URL: "http://127.0.0.1:8000/v1/",
  MODEL_API_KEY: "local-test-key",
  MODEL_CHAT_MODEL: "qwen-chat",
  MODEL_EXTRACTOR_MODEL: "qwen-extractor",
  MODEL_CLASSIFIER_MODEL: "qwen-classifier",
  MODEL_RESOLVER_MODEL: "qwen-resolver",
  MODEL_REQUEST_TIMEOUT_MS: "30000",
} as const;

describe("Qwen/vLLM provider configuration", () => {
  it("loads and normalizes every required environment value", () => {
    expect(loadQwenVllmProviderConfiguration(validEnvironment)).toEqual({
      baseUrl: "http://127.0.0.1:8000/v1",
      apiKey: "local-test-key",
      chatModel: "qwen-chat",
      extractorModel: "qwen-extractor",
      classifierModel: "qwen-classifier",
      resolverModel: "qwen-resolver",
      requestTimeoutMs: 30_000,
    });
  });

  it("allows an explicitly unauthenticated local runtime", () => {
    expect(
      loadQwenVllmProviderConfiguration({
        ...validEnvironment,
        MODEL_API_KEY: "",
      }).apiKey,
    ).toBeNull();
  });

  it("accepts a model name exactly at the response identity boundary", () => {
    expect(
      loadQwenVllmProviderConfiguration({
        ...validEnvironment,
        MODEL_CHAT_MODEL: "m".repeat(200),
      }).chatModel,
    ).toHaveLength(200);
  });

  it.each([
    [{ ...validEnvironment, MODEL_CHAT_MODEL: "" }, "MODEL_CHAT_MODEL", ""],
    [
      { ...validEnvironment, MODEL_CHAT_MODEL: "m".repeat(201) },
      "MODEL_CHAT_MODEL",
      "m".repeat(201),
    ],
    [{ ...validEnvironment, MODEL_REQUEST_TIMEOUT_MS: "0" }, "MODEL_REQUEST_TIMEOUT_MS", "0"],
    [
      { ...validEnvironment, MODEL_REQUEST_TIMEOUT_MS: "not-a-number" },
      "MODEL_REQUEST_TIMEOUT_MS",
      "not-a-number",
    ],
    [{ ...validEnvironment, MODEL_REQUEST_TIMEOUT_MS: "0x10" }, "MODEL_REQUEST_TIMEOUT_MS", "0x10"],
    [{ ...validEnvironment, MODEL_API_KEY: "secret\nheader" }, "MODEL_API_KEY", "secret\nheader"],
  ])(
    "rejects an invalid environment field without exposing its value",
    (environment, field, invalidValue) => {
      let thrown: unknown;
      try {
        loadQwenVllmProviderConfiguration(environment);
      } catch (error) {
        thrown = error;
      }
      expect(thrown).toBeInstanceOf(ModelProviderConfigurationError);
      if (!(thrown instanceof Error)) {
        throw new TypeError("Expected configuration loading to throw an Error.");
      }
      expect(thrown.message).toContain(field);
      if (invalidValue !== "") {
        expect(thrown.message).not.toContain(invalidValue);
      }
    },
  );

  it.each([
    "file:///tmp/model-runtime",
    "https://user:password@example.test/v1",
    "https://example.test/v1?api_key=secret",
    "relative/v1",
  ])("rejects unsafe or non-absolute base URL %s", (baseUrl) => {
    expect(() =>
      loadQwenVllmProviderConfiguration({
        ...validEnvironment,
        MODEL_BASE_URL: baseUrl,
      }),
    ).toThrow(ModelProviderConfigurationError);
  });

  it("normalizes an origin-only base URL", () => {
    expect(
      loadQwenVllmProviderConfiguration({
        ...validEnvironment,
        MODEL_BASE_URL: "https://models.example.test/",
      }).baseUrl,
    ).toBe("https://models.example.test");
  });
});
