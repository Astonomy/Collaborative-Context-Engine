# S4: Framework-neutral HTTP boundary

## Outcome and dependency direction

All 34 REST route modules now delegate to `apps/api/handlers`. The boundary is a factory receiving a lazy, typed service supplier and returning handlers over standard Web `Request`, plain path parameters and `Promise<Response>`. It does not import or execute Next. The lazy supplier preserves runtime initialization inside the existing error boundary. Schemas, use-case calls, status codes, request IDs and cache/stream headers are retained.

`Next route -> apps/api/handlers -> application/agents -> domain/context-engine + ports`

`apps/api/server/runtime -> application services + infrastructure implementations`

`apps/web/server/runtime` re-exports the single composition root for compatibility; there is still one process-local pool/service singleton. Environment configuration, connection options and storage location semantics are retained. Application use cases retain transactions, idempotency, optimistic concurrency and object-level authorization. The former web member/merge queries now live in `packages/application/src/project-queries.ts` with their original authorization and UnitOfWork boundaries.

S0/ADR 0009 proposes `apps/api` ownership but does not select a replacement HTTP framework. This scope establishes that source boundary without introducing a framework or separate listener. Next remains the production entry point. The imports/provider-submission and attachment routes were mechanically adapted; their application implementations and contracts are unchanged. MCP implementation and its route were left in place as requested.

## Route inventory

The table below lists every explicit route method. Each REST path maps to the corresponding relative module under `apps/api/handlers`. Next-generated HEAD/OPTIONS/405 handling stays with the host.

| Path                                                                                          | Explicit methods                                                                  |
| --------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| `/api/health`                                                                                 | GET                                                                               |
| `/api/projects`                                                                               | GET, POST                                                                         |
| `/api/session`                                                                                | GET, POST, DELETE                                                                 |
| `/api/projects/[projectId]`                                                                   | GET, PATCH                                                                        |
| `/api/projects/[projectId]/audit`                                                             | GET                                                                               |
| `/api/projects/[projectId]/context`                                                           | GET                                                                               |
| `/api/projects/[projectId]/conversations`                                                     | GET, POST                                                                         |
| `/api/projects/[projectId]/imports`                                                           | POST                                                                              |
| `/api/projects/[projectId]/members`                                                           | GET, POST                                                                         |
| `/api/projects/[projectId]/merge-requests`                                                    | GET, POST                                                                         |
| `/api/projects/[projectId]/agents/runs`                                                       | GET, POST                                                                         |
| `/api/projects/[projectId]/attachments/[attachmentId]`                                        | GET                                                                               |
| `/api/projects/[projectId]/context/commits`                                                   | GET                                                                               |
| `/api/projects/[projectId]/context/items`                                                     | GET                                                                               |
| `/api/projects/[projectId]/conversations/[conversationId]`                                    | GET, PATCH                                                                        |
| `/api/projects/[projectId]/imports/preview`                                                   | POST                                                                              |
| `/api/projects/[projectId]/imports/provider-previews`                                         | POST                                                                              |
| `/api/projects/[projectId]/imports/provider-submissions`                                      | POST                                                                              |
| `/api/projects/[projectId]/imports/[importId]`                                                | GET                                                                               |
| `/api/projects/[projectId]/members/[userId]`                                                  | PUT                                                                               |
| `/api/projects/[projectId]/merge-requests/[mergeRequestId]`                                   | GET                                                                               |
| `/api/projects/[projectId]/agents/runs/[runId]`                                               | GET                                                                               |
| `/api/projects/[projectId]/attachments/[attachmentId]/content`                                | GET                                                                               |
| `/api/projects/[projectId]/attachments/[attachmentId]/inspection`                             | GET                                                                               |
| `/api/projects/[projectId]/conversations/[conversationId]/attachments`                        | POST                                                                              |
| `/api/projects/[projectId]/conversations/[conversationId]/chat`                               | POST                                                                              |
| `/api/projects/[projectId]/conversations/[conversationId]/deltas`                             | POST                                                                              |
| `/api/projects/[projectId]/conversations/[conversationId]/extract`                            | POST                                                                              |
| `/api/projects/[projectId]/conversations/[conversationId]/messages`                           | GET, POST                                                                         |
| `/api/projects/[projectId]/merge-requests/[mergeRequestId]/finalize`                          | POST                                                                              |
| `/api/projects/[projectId]/agents/runs/[runId]/cancel`                                        | POST                                                                              |
| `/api/projects/[projectId]/agents/runs/[runId]/reconcile`                                     | POST                                                                              |
| `/api/projects/[projectId]/agents/runs/[runId]/resume`                                        | POST                                                                              |
| `/api/projects/[projectId]/merge-requests/[mergeRequestId]/conflicts/[conflictId]/resolution` | PUT                                                                               |
| `/mcp`                                                                                        | GET, POST, DELETE (standalone adapter in apps/api; legacy Next wrapper delegates) |

No Server Actions or `use server` directives were found in apps/web. UI pages/layout remain presentation entry points.

## Server utility inventory

| Previous responsibility                                                                                                       | Current owner                                                                                                             |
| ----------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| server/request.ts: bounded 8 MiB JSON, strict UTF-8, path/query validation, duplicate query rejection, errors and request IDs | apps/api/server/request.ts; web compatibility export also authenticates the unchanged MCP facade                          |
| request.ts: authenticated principal extraction                                                                                | Standard Authorization/Cookie headers in apps/api; SessionService validates token; application authorizes every operation |
| server/session-cookie.ts: encrypted v1 token, eight-hour lifetime, cookie flags                                               | apps/api/server/session-cookie.ts; web compatibility export                                                               |
| server/runtime.ts: env, pool, service construction and singleton                                                              | apps/api/server/runtime.ts; web compatibility re-export                                                                   |
| server/queries.ts: member and merge authorization/UoW                                                                         | packages/application/src/project-queries.ts; web compatibility re-export                                                  |
| server/attachment-content.ts: streaming input, download/range responses                                                       | apps/api/server/attachment-content.ts; web compatibility re-export                                                        |
| chat route: first-event gate, POST SSE framing, error event, AbortSignal and iterator cleanup                                 | apps/api/handlers/.../chat/route.ts                                                                                       |
| next.config.ts: CSP, HSTS and other security headers, standalone build                                                        | Existing Next host, unchanged                                                                                             |

## Authentication and client contract

Bearer remains authoritative when present, including malformed/invalid Bearer rejection instead of falling back to a cookie. Cookie parsing preserves URI decoding and last valid duplicate value behavior. Cookie-authenticated mutations require an exact request Origin match; session creation/deletion always require it. The cookie name, v1 encryption, secret, HttpOnly, Secure-in-production, SameSite=strict, Path=/ and max-age remain unchanged. Application receives the authenticated actor ID; client fields never supply the trusted actor.

Both frontends call the same same-origin `/api/*` REST URLs with fetch, JSON DTOs from `@cce/api-contracts`, cookies or existing Bearer credentials. Chat remains POST fetch SSE, with the same event schemas. No Vue code, alternate DTOs, CORS policy or authentication redesign is required. Contract tests compare Next adapters with direct standard-Request handler calls, while making Next runtime loading fail. This establishes shared server behavior, not a claim that a Vue UI was built.

## Remaining host dependencies and deployment

Next still owns URL/method routing, Promise params adaptation, framework-generated HEAD/OPTIONS/405, HTTP socket/body/stream delivery, security headers, server process lifecycle and standalone packaging. The MCP facade still uses a NextRequest type through the compatibility auth adapter; its behavior is unchanged. React/Next UI and build dependencies remain. No Next runtime import remains in apps/api, application, domain or context-engine.

Deploy using the existing Next build/start and same-origin ingress. A future independent listener must mount these handlers and preserve request URL/Origin, cancellation, streaming, generated method behavior, security headers and pool shutdown. This scope does not claim a runnable independent host. Existing storage cwd/environment and migration deployment requirements still apply.

## Validation

- `pnpm exec vitest run apps/api apps/web/server packages/api-contracts`: HTTP contract, existing request/cookie/attachment tests and schemas.
- `pnpm exec vitest run tests/unit/application`: use cases and error paths, including concurrency/merge behavior.
- `pnpm typecheck` explicitly includes apps/api; `pnpm lint` forbids Next/React imports in the extracted server and application.
- HTTP contract cases include successful project/conversation operations, authentication, actual application RBAC/object scope, validation, not found, idempotent messages/conflicting retries, stale expected HEAD with unchanged transaction state, cookie/Origin/Bearer behavior, SSE framing/errors/cancellation, and Next/direct-client equivalence.
- These application-backed HTTP tests use the existing in-memory port adapter; they do not replace PostgreSQL integration tests or establish database-level concurrency guarantees.

Recorded validation on 2026-09-29: focused/API/application tests passed (174 tests); the full unit suite and configured coverage gate passed (479 tests); typecheck, lint, production build and formatting of S4-touched files passed. The repository-wide format check reported 61 existing files outside this change.

`pnpm exec playwright test tests/e2e/golden-flow.spec.ts` passed both Chromium tests (Owner review flow and Viewer read-only controls) against the Next frontend with the existing HTTP fixtures. These browser tests do not substitute for real PostgreSQL-backed HTTP tests.

`pnpm test:e2e` could not start because `tsx` is missing; the configured `scripts/run-postgres-tests.mts` runner is also absent. Invoking `pnpm exec vitest run --config vitest.integration.config.ts` directly reached Testcontainers but failed setup with `Could not find a working container runtime strategy`; none of its 12 database tests executed. Empty-database migrations, PostgreSQL integration and database-backed HTTP E2E remain unverified in this workspace.
