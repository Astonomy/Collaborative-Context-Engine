# Architecture

CCE is a TypeScript modular monolith that implements Git-like collaboration for semantic project context. PostgreSQL stores evidence and canonical state; models are replaceable proposal engines.

```text
Browser
  -> Next.js UI and REST/SSE routes
  -> Application use cases (authentication, RBAC, transactions)
  -> Domain + deterministic Context Engine
  -> PostgreSQL repository / ModelProvider adapters
```

External export and provider-submission adapters live in `packages/conversation-import`. They normalize untrusted provider data into an IR before application orchestration; persisted imports create Conversation/Message evidence and an append-only provenance manifest, never direct canonical context mutations. `packages/mcp-server` is a thin provider-facing facade over those application use cases and contains no persistence logic. See [Conversation import](conversation-import.md), [ADR 0007](adr/0007-external-conversations-import-as-evidence.md), and [ADR 0008](adr/0008-provider-plugin-submissions.md).

## Package responsibilities

| Package          | Responsibility                                                  | May depend on                   |
| ---------------- | --------------------------------------------------------------- | ------------------------------- |
| `domain`         | Entities, schemas, invariants, state transitions                | Zod, shared                     |
| `context-engine` | ContextBuilder, routing, deterministic three-way merge          | domain, shared                  |
| `application`    | Use cases, ports, RBAC, idempotency, transaction orchestration  | domain, context-engine          |
| `database`       | PostgreSQL schema, migrations, repository/unit-of-work adapters | application, domain, Drizzle/pg |
| `model-provider` | OpenAI-compatible HTTP/SSE adapter and normalized failures      | application, domain             |
| `api-contracts`  | Runtime-validated transport DTOs                                | domain                          |
| `agents`         | Persisted, approval-aware workflows producing Deltas            | application, domain             |
| `mcp-server`     | Validated CCE plugin tools and Streamable HTTP transport        | application, domain, import IR  |
| `web`            | UI, route handlers, auth/session adapter, composition root      | public APIs above               |

Dependency arrows always point inward. Domain does not know Next.js, SQL, HTTP, or a model vendor. A remote model never becomes a state store.

## Commit topology

Canonical history is linear for the MVP. A Conversation has one Branch whose immutable base commit records the context the participant saw. The branch produces Delta proposals; it does not create an independent commit DAG. Merging a Delta creates one new commit from the then-current HEAD.

## Transaction boundary

Model extraction and semantic classification finish before finalization. Finalization locks the project row, checks the expected HEAD, validates every resolution, writes all immutable records and the projection, then advances HEAD. A failure rolls back every write.
