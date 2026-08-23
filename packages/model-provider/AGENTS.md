# Model Provider rules

- All model calls implement `ModelProvider`; provider-specific options stay inside adapters.
- Endpoint, model names, credentials, and timeouts come from validated configuration.
- Validate structured output and normalize timeouts, authentication, rate limits, unavailable models, malformed streams, and server errors.
- Unit and contract tests use fake providers or local fake HTTP servers. Real model smoke tests are opt-in.
- Record provider/model/prompt version/usage/latency metadata without logging secrets.
