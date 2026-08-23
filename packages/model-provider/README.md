# Model provider adapter

`@cce/model-provider` implements the application `ModelProvider` port for a Qwen model served
through a vLLM OpenAI-compatible chat-completions endpoint. It uses Node's native `fetch`; no
provider SDK is required.

## Configuration

Call `loadQwenVllmProviderConfiguration(process.env)` at the composition root. The loader requires
and validates:

- `MODEL_BASE_URL`
- `MODEL_CHAT_MODEL`
- `MODEL_EXTRACTOR_MODEL`
- `MODEL_CLASSIFIER_MODEL`
- `MODEL_RESOLVER_MODEL`
- `MODEL_REQUEST_TIMEOUT_MS`

`MODEL_API_KEY` may be empty only for a deliberately unauthenticated local runtime. The base URL
must be an absolute HTTP(S) URL without embedded credentials, a query, or a fragment. The adapter
adds `/chat/completions` to that URL.

Concrete models are selected by request purpose: chat, extraction, classification, and agent map
to the four model settings above. Application code still owns logical profile routing and never
contains concrete model names.

## Behavior

The adapter supports complete responses, OpenAI-compatible SSE streaming, usage normalization, and
strict JSON Schema response formats. Structured content is checked locally against the supplied
schema before it is returned or the stream emits its finish event.

Provider failures are exposed only as `ModelProviderError`. Authentication, rate limiting,
timeouts, connection failures, server failures, unavailable models, malformed output, interrupted
streams, and incompatible capabilities have stable codes and retryability. Remote response text,
request messages, endpoint URLs, and API keys are never included in normalized error messages.

`FakeModelProvider` is a deterministic scripted adapter for model-provider contract tests. The
application's general-purpose test fixtures remain in `@cce/test-support`.
