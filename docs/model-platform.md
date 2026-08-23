# Model platform

CCE defaults to a Qwen model served by vLLM through an OpenAI-compatible API. Business code selects logical profiles rather than concrete model names:

| Profile  | Initial use                                                |
| -------- | ---------------------------------------------------------- |
| `small`  | deterministic-adjacent classification and dedup assistance |
| `medium` | chat and structured context extraction                     |
| `large`  | ambiguous conflict analysis and complex planning           |

Provider calls carry explicit CCE messages and ContextPack state. Structured responses are Zod-validated. Retry is bounded and only applied to safe, idempotent requests. Authentication, rate limit, timeout, unavailable model, server, malformed output, and interrupted stream failures are normalized.

Core prompt IDs and versions are persisted with model-run metadata. Raw prompts/results are not logged by default because they may contain project secrets; hashes and controlled summaries support audit without unnecessary data duplication.
