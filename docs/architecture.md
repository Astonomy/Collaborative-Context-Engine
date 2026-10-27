# Architecture

Default runtime boundaries are static `apps/vue` → standalone `apps/api` → application/domain
and adapters. The submit plugin connects directly to API `/mcp`. `apps/web` is an explicit legacy
host, excluded from the API production deployment graph. See [final decoupling report](vue-api-decoupling.md).

CCE is a TypeScript modular monolith that implements Git-like collaboration for semantic project context. PostgreSQL stores evidence and canonical state; models are replaceable proposal engines.

The [S0 audit](s0-architecture-performance-baseline.md) and [ADR 0009](adr/0009-browser-api-boundary-and-vue-migration.md)
record the migration plan. [ADR 0010](adr/0010-default-vue-ui.md) makes Vue the default browser at `/vue/`,
reached from `/` in the historical Next deployment. The default independent static build now uses `/`; Next is an optional legacy host. The standalone
Node API hosts REST/SSE/MCP independently; Next routes remain compatibility adapters.

```text
Browser
  -> Vue UI -> public /api ingress -> standalone Node REST/SSE handlers
  -> Application use cases (authentication, RBAC, transactions)
  -> Domain + deterministic Context Engine
  -> PostgreSQL repository / ModelProvider adapters
```

External export and provider-submission adapters live in `packages/conversation-import`. They normalize untrusted provider data into an IR before application orchestration; persisted imports create Conversation/Message evidence and an append-only provenance manifest, never direct canonical context mutations. `packages/mcp-server` is a thin provider-facing facade over those application use cases and contains no persistence logic. See [Conversation import](conversation-import.md), [ADR 0007](adr/0007-external-conversations-import-as-evidence.md), and [ADR 0008](adr/0008-provider-plugin-submissions.md).

Repeated plugin submissions carry the previous successful import ID and only new messages. The application resolves the existing Conversation from project-scoped import provenance and appends evidence under project/conversation locks. Each delta keeps its own immutable manifest and audit record; the Conversation and its Branch are reused. The Skill keeps the submission boundary; the server enforces ownership, source consistency, predecessor freshness, and retry idempotency.

## Package responsibilities

| Package          | Responsibility                                                  | May depend on                                          |
| ---------------- | --------------------------------------------------------------- | ------------------------------------------------------ |
| `domain`         | Entities, schemas, invariants, state transitions                | Zod, shared                                            |
| `context-engine` | ContextBuilder, routing, deterministic three-way merge          | domain, shared                                         |
| `application`    | Use cases, ports, RBAC, idempotency, transaction orchestration  | domain, context-engine                                 |
| `database`       | PostgreSQL schema, migrations, repository/unit-of-work adapters | application, domain, Drizzle/pg                        |
| `model-provider` | OpenAI-compatible HTTP/SSE adapter and normalized failures      | application, domain                                    |
| `api-contracts`  | Runtime-validated transport DTOs                                | domain                                                 |
| `agents`         | Persisted, approval-aware workflows producing Deltas            | application, domain                                    |
| `mcp-server`     | Validated CCE plugin tools and Streamable HTTP transport        | application, domain, import IR                         |
| `server-runtime` | Server-only infrastructure and application composition          | application, agents, database, model-provider, storage |
| `vue`            | Static browser UI and HTTP API client                           | api-contracts, Vue                                     |
| `api`            | Standalone REST/SSE/MCP listener and session adapters           | server-runtime, application, domain, contracts, MCP    |
| `web`            | Explicit legacy UI/Next compatibility host                      | public APIs above                                      |

Dependency arrows always point inward. Domain does not know Next.js, SQL, HTTP, or a model vendor. A remote model never becomes a state store.

## Commit topology

Canonical history is linear for the MVP. A Conversation has one Branch whose immutable base commit records the context the participant saw. The branch produces Delta proposals; it does not create an independent commit DAG. Merging a Delta creates one new commit from the then-current HEAD.

## Transaction boundary

Model extraction and semantic classification finish before finalization. Finalization locks the project row, checks the expected HEAD, validates every resolution, writes all immutable records and the projection, then advances HEAD. A failure rolls back every write.

Attachment uploads stream through the framework-neutral application storage port before a short transaction creates immutable Attachment evidence and its new Message. The local storage adapter and authenticated range delivery are described in [Attachment binary lifecycle (S2)](attachment-binary-lifecycle.md).

Media inspection uses an application port and a separately exported Node adapter. It returns a bounded, read-only metadata/preview capability view without changing canonical Attachment evidence. See [Media inspection (S3)](media-inspection.md) for API, security limits, deployment and browser-boundary validation.

## S4 server boundary

S4 extracts REST handlers and composition into `apps/api`, using standard Request/Response and injected application services. Next routes remain thin adapters; member/merge query authorization moved into application. See [S4 inventory and dependency direction](s4-server-boundary.md).

## S6 Vue product migration

Vue now exposes route-owned conversation, merge, context and history flows. Parent project access is a shallow snapshot; child route disposal cancels pending work. See [S6 UI migration](s6-ui-migration.md). Next remains available until S8.

S8 adds persisted attachment discovery through the existing REST → application → repository boundary.
Vue associates returned metadata by immutable message ID; browser memory is not the attachment source
of truth. The PostgreSQL-scoped list restores previews after reload. Local storage closes a read handle
as soon as its final byte is read, including range reads where an HTTP consumer does not ask for EOF.
No model/provider/domain responsibility moved. Next remains the server and browser rollback path;
see [integration verification](s8-integration-verification.md) for the cutover decision.

## Server runtime composition

Composition is owned by `@cce/server-runtime`; the API host adds cookie/session transport and singleton lifecycle. See [server composition](server-runtime-composition.md).

Authentication runtime and transport security: see [auth runtime audit](auth-runtime-audit.md).

# Vue API connection boundary

Vue resolves REST, POST SSE and attachment/media requests through its API client and
`VITE_CCE_API_BASE_URL`. Components consume validated DTOs, including message attachment
arrays. See [endpoint matrix and outstanding host migration](vue-api-endpoints.md).

See [standalone attachment delivery](standalone-attachments.md) for the audited
attachment chain, authorized streaming/MIME/Range behavior, independent API/Vue
startup and PostgreSQL-backed browser verification without Next.js.

Standalone attachment upload, metadata, authorized streaming delivery and Vue previews are documented in [Standalone attachment delivery](standalone-attachment-delivery.md).

The standalone Node API mounts `/mcp` through `apps/api/handlers/mcp/route.ts`. The legacy Next route delegates to this adapter. Local plugin binary uploads use project-scoped immutable `import_attachment_uploads` staging records and storage identities. Application import orchestration validates actor/expiry before preview and binds attachments before inserting their new Message in the same PostgreSQL transaction. Neither transport nor the plugin changes canonical Project Context.

# Standalone streaming boundary

`apps/api` owns stream framing and Node lifecycle; application ChatEvent generation
remains HTTP-framework independent. See [endpoint inventory](standalone-streaming.md#endpoint-inventory).

The default scripts and deployment now run independent Vue static hosting and Node API; see
[deployment topology](deployment.md). Previous Next hosting descriptions are historical.
