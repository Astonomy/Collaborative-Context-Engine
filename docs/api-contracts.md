# API contracts

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
