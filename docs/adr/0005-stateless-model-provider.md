# ADR 0005: Stateless-first model provider

- Status: Accepted
- Date: 2026-08-23

## Decision

All model calls use the CCE `ModelProvider` port with explicit messages and a ContextPack. An OpenAI-compatible adapter supports Qwen/vLLM first. Provider conversation IDs are optional runtime optimizations and can be discarded without losing project or conversation history.

Model names map to logical profiles (`small`, `medium`, `large`) through validated configuration. Structured output is parsed and runtime-validated. Errors and stream termination are normalized. Model calls never occur inside a database transaction and never directly mutate persistence.

Embeddings are a separate optional capability because the MVP does not use RAG.
