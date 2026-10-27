# API contracts

Default browser entry routing serves static Vue at `/`, with SPA fallback for browser routes.
The gateway sends `/api/*` and `/mcp` to the standalone API; API misses retain JSON/HTTP errors.
The explicit legacy Next host redirects `/` to `/vue/` and provides `/legacy`.
Attachment discovery remains separate from message responses.

The public transport is REST plus Server-Sent Events for chat. Resources are nested below Project
wherever possible, and every project-owned lookup includes the path `projectId`:

```text
GET /api/health
GET|POST|DELETE /api/session
GET|POST /api/projects
GET /api/projects/:projectId
GET|POST /api/projects/:projectId/members
PUT /api/projects/:projectId/members/:userId
GET|POST /api/projects/:projectId/conversations
GET|POST /api/projects/:projectId/conversations/:conversationId/messages
POST /api/projects/:projectId/conversations/:conversationId/chat (SSE)
POST /api/projects/:projectId/conversations/:conversationId/deltas
POST /api/projects/:projectId/conversations/:conversationId/extract
GET /api/projects/:projectId/context
GET /api/projects/:projectId/context/items
GET /api/projects/:projectId/context/commits
GET|POST /api/projects/:projectId/merge-requests
GET /api/projects/:projectId/merge-requests/:mergeRequestId
PUT /api/projects/:projectId/merge-requests/:mergeRequestId/conflicts/:conflictId/resolution
POST /api/projects/:projectId/merge-requests/:mergeRequestId/finalize
POST /api/projects/:projectId/agents/runs
GET /api/projects/:projectId/agents/runs/:runId
POST /api/projects/:projectId/agents/runs/:runId/resume
POST /api/projects/:projectId/agents/runs/:runId/cancel
POST /api/projects/:projectId/imports/provider-previews
POST /api/projects/:projectId/imports/provider-submissions
GET|POST|DELETE /mcp
```

`POST /deltas` is the resource-oriented extraction endpoint used by the UI; `POST /extract` exposes the
same validated extraction operation for explicit command-style clients. Both accept an optional
`throughMessageSequence` and return the persisted immutable `ContextDelta` with status 201.

Conversation import uses generic project-scoped resources: `POST /imports/preview` parses a base64-encoded ChatGPT JSON file without persistence; `POST /imports` repeats validation and atomically persists selected evidence; `GET /imports/:importId` reads the project-scoped append-only manifest. Preview and confirmation intentionally remain separate. ZIP uploads are rejected. The separate plugin/MCP submission contracts are unchanged.

Provider-facing clients send the normalized capture, including an optional evidence `summary`, to `POST /imports/provider-previews`, then send only `{ "previewId": "..." }` to `POST /imports/provider-submissions`. The preview returns the summary when supplied, is bound to the authenticated user and project, expires after 15 minutes, and reports duplicate identity without creating evidence. File and image reference values and metadata are retained unchanged in the import manifest; only text blocks become CCE Messages. `/mcp` exposes the same application use cases as `list_projects`, `preview_conversation_import`, and `submit_conversation_import`; it is an integration facade, not a second persistence implementation. All three accept the existing CCE cookie/bearer authentication at the deployed endpoint.

Provider preview bodies also accept an optional UUID `previousImportId`. When supplied, `messages` contains only the new messages since that successful import. Preview responses include `operation: "create" | "append"` and, for append, `targetConversationId`; `messageCount` is the number of messages in this delta. The submit body is unchanged. An append returns a new import ID and the same Conversation ID, with `messageCount` counting that import's messages (also on an idempotent retry). The previous import must be in the same project, belong to the authenticated importing user, and have the same provider source. A missing or other-actor predecessor is not found; a stale predecessor, mismatched provider conversation ID, or archived target conflicts. Submit serializes predecessor checks and message sequence allocation inside the existing transaction.

## Authentication and request safety

`POST /api/session` accepts `{ "apiToken": "..." }` and sets the encrypted, HttpOnly, SameSite=Strict
`cce_session` cookie. `GET /api/session` returns the authenticated user and `DELETE` clears the cookie.
Non-safe cookie-authenticated requests require an exact same-origin `Origin` header. API clients may
instead send `Authorization: Bearer <token>`; bearer authentication is not subject to the browser
origin check. Only a SHA-256 token digest is persisted.

Request/response schemas live in `@cce/api-contracts`. Invalid syntax is 400, missing authentication
401, an authenticated member lacking a capability 403, inaccessible/nonexistent project resources 404,
stale/idempotency conflicts 409, domain invariant violations 422, rate limits 429, and sanitized
unexpected failures 500/503. Error responses include a safe request ID for log correlation.

## Streaming and idempotency

The chat route returns `text/event-stream`. Its validated event sequence persists the user evidence
before `user_persisted`, then emits `assistant_started`, one or more `text_delta` events, and a terminal
`completed` message. An interrupted provider stream is persisted as a terminal failed assistant message
and is never reported as completed.

Message creation accepts a client-generated UUID `clientMessageId` for idempotency. Merge finalization
requires the `Idempotency-Key` header plus `expectedHeadCommitId`, and returns 409 when its evaluated HEAD
is stale. PostgreSQL stores one immutable finalization outcome per MergeRequest. Repeating its key returns
the same `committed` or `no_changes` result without another commit or audit event; using a different key
after either outcome returns 409.

`GET /context` returns HEAD plus current items. Both it and `/context/items` support optional `kind` and
`lifecycle` filters, while `/context/commits` exposes the immutable project commit history. These are
views over PostgreSQL canonical state, never reconstructed from a provider conversation.

## S4 server boundary

REST URLs, methods, DTOs and SSE remain unchanged. Framework-neutral handlers in `apps/api/handlers` serve the existing Next adapters and any future same-origin frontend. See [S4 server boundary and route inventory](s4-server-boundary.md).

## S6 Vue product migration

The S6 Vue client consumes the existing REST and chat SSE endpoints without contract changes. Delta extraction uses POST /deltas; human review creates a merge request and finalization sends expectedHeadCommitId plus an idempotency-key. See [the migration matrix](s6-ui-migration.md) for endpoint dependencies.

## S8 persisted attachment discovery

`GET /api/projects/{projectId}/conversations/{conversationId}/attachments` returns an array of
`attachmentResponseSchema` metadata (no storage locators). Authentication and application project-read
authorization precede the scoped conversation lookup. Missing membership or a foreign conversation
returns 404; unauthenticated requests return 401. Reads remain available for archived evidence.
The list is ordered by message identity and attachment ordinal; the UI binds by message ID and displays
persisted message sequence. It does not imply canonical state or create a ContextCommit.
Availability is rechecked by the existing metadata/inspection/content use cases before preview/download.
There is one list request per conversation load, not one request per message; the list is currently
unpaginated, as is the messages endpoint. Vue reloads it after upload and on page reload.

## Server runtime composition

This composition scope changes no REST/SSE/MCP route or DTO. Handlers receive the same services through the API runtime adapter; see [server composition](server-runtime-composition.md).

Authentication runtime and transport security: see [auth runtime audit](auth-runtime-audit.md).

# Vue message attachment projection

GET conversation messages includes `attachments[]` on each message, joined by message ID
after authorization and projected without storage locators. Older message/event payloads
normalize missing arrays to empty arrays. Vue never infers attachments from message text.
See [Vue endpoint matrix](vue-api-endpoints.md).

See [standalone attachment delivery](standalone-attachments.md) for the audited
attachment chain, authorized streaming/MIME/Range behavior, independent API/Vue
startup and PostgreSQL-backed browser verification without Next.js.

Standalone attachment upload, metadata, authorized streaming delivery and Vue previews are documented in [Standalone attachment delivery](standalone-attachment-delivery.md).

Standalone plugin attachment staging: `POST /api/projects/{projectId}/imports/attachments` accepts raw binary, authenticated CCE bearer identity, `Content-Type`, encoded `X-CCE-Filename`, and UUID `X-CCE-Upload-Id`. It returns `attachmentId`, filename, byteSize, SHA-256 checksum and expiresAt. It creates no Message. Provider submission messages accept `attachmentIds`; previews return a validated attachment inventory. Confirmed submission binds uploads atomically to original supported messages. IDs are project/user scoped, expire after 24 hours, and cannot bind to multiple messages. Existing conversation attachment upload remains a separate immediate-evidence flow.

# Standalone stream lifecycle

See [streaming inventory and lifecycle](standalone-streaming.md) for all streaming
transports, event compatibility, cancellation and terminal behavior.
