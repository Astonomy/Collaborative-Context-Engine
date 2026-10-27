# Standalone streaming transport

## Endpoint inventory

Repository searches for EventSource, text/event-stream, ReadableStream, stream,
SSE, agent run, progress, delta and events identify these public transports:

| Endpoint                                               | Transport                                           | Standalone implementation                                                             |
| ------------------------------------------------------ | --------------------------------------------------- | ------------------------------------------------------------------------------------- |
| POST `/api/projects/{p}/conversations/{c}/chat`        | fetch POST SSE                                      | `apps/api/handlers/projects/[projectId]/conversations/[conversationId]/chat/route.ts` |
| GET `/api/projects/{p}/attachments/{a}/content`        | Binary response stream, including Range             | `apps/api/server/attachment-content.ts`                                               |
| POST `/api/projects/{p}/conversations/{c}/attachments` | Binary request stream                               | attachment handler and `attachmentRequestBytes`                                       |
| POST `/api/projects/{p}/imports/attachments`           | Binary request stream                               | import attachment handler and `attachmentRequestBytes`                                |
| `/mcp` POST/GET/DELETE                                 | MCP Streamable HTTP, configured with JSON responses | `apps/api/handlers/mcp/route.ts`, `packages/mcp-server`                               |

Agent runs (create/read/resume/reconcile/cancel), audit and extraction
(`/extract`, `/deltas`) return JSON. They have no progress/delta/event subscription
endpoint. Upload progress is browser XHR progress. Provider SSE is an outbound
ModelProvider transport, not a browser endpoint. No new event protocol is introduced.
Next route files remain compatibility adapters to the same API handlers.

## Event and lifecycle contract

Application `ChatService` yields framework-independent `ChatEvent` values.
The HTTP handler validates `chatStreamEventSchema`, preserves generator order and
frames `assistant_started`, `text_delta` and `completed` without changing payloads.
Authentication, authorization and failures before the first event remain JSON HTTP
errors; later failures use the existing `event: error` API error envelope.
`completed` is terminal: the handler returns the iterator and closes the response;
Vue stops reading and cancels its reader. EOF without completion is an error.
Interrupted POST requests are never automatically retried.

The Node bridge propagates connection close to Request.signal and cancels pending
response reads. Its default total request deadline is 300 seconds; timeout aborts
the request and closes the socket. Vue independently uses a 300-second total stream
deadline and exposes AbortError/TimeoutError to the existing interrupted-chat UI.
Cancellation reaches the provider through the application AbortSignal; the
application retains responsibility for persisted interrupted evidence.

SIGINT/SIGTERM stop acceptance, abort active requests, close connections, wait for
request cleanup, then close the runtime pool. `StandaloneServer.shutdown()` is
idempotent. Reverse proxies must disable SSE buffering and allow the request
deadline; shutdown does not replay streams or promise resumable delivery.

## Authentication and deployment

Vue resolves streaming URLs through ApiClient and `VITE_CCE_API_BASE_URL`, with
credentials: include. An empty base uses relative `/api` behind the same public
origin; Vite's default API proxy targets standalone port 3001. Production ingress
must route `/api` to standalone, independently of the Next UI listener.
The existing encrypted HttpOnly session cookie, SameSite policy and POST Origin
checks remain in force. Existing non-browser clients may use Authorization Bearer.
No secret is added to URLs. Setting a separate API origin does not enable CORS;
deploy behind one public origin to retain the existing cookie security design.

## Verification

`apps/api/handlers/http-contract.test.ts` checks ordering, headers, pre/post-first
event errors, cancellation and authenticated real HTTP with Next runtime disabled.
`apps/api/http-server.test.ts` checks disconnect, timeout and shutdown over real
sockets with pending reads. Vue chat stream tests cover schema validation,
fragmented UTF-8/CRLF, incomplete streams, errors, abort, timeout and terminal events
on connections that remain open. Standalone browser suites run with
`pnpm test:e2e:attachments`; their host starts API plus Vite without Next.

Final source audit commands:

```powershell
rg -n 'EventSource|text/event-stream|ReadableStream|fetch\(|NEXT_PUBLIC|localhost:3000|127\.0\.0\.1:3000' apps/vue
rg -n 'VITE_CCE_API_BASE_URL|CCE_API_PROXY_TARGET' apps/vue scripts/dev-standalone.mjs
```

Historical Next-hosted test configurations and documentation can contain port 3000. Product streaming code uses ApiClient; there is no EventSource or streaming
fetch with a Next origin.

Verification on 2026-10-08: lint, typecheck, coverage (520 core tests, 142 Vue
tests, four plugin tests) and production build passed. Real HTTP stream tests
passed without loading Next. `pnpm validate` stopped on 60 existing unrelated
format warnings; those files were preserved. PostgreSQL integration, regular E2E
and standalone browser E2E could not connect to localhost:5432 (ECONNREFUSED), so
empty-database migrations and database-backed browser verification remain pending.
