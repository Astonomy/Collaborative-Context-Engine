# Vue frontend (S5 foundation + S6 product flows)

The Vue frontend now includes the existing Next product flows: project and conversation
lifecycle, streaming chat, Delta preview, merge review/commit, scoped agent approval,
canonical context and history. See the [migration matrix](../../docs/s6-ui-migration.md).
Vue uses the configured standalone API origin. Repository-wide startup and packaging still
use the legacy host; see the [endpoint matrix and remaining dependencies](../../docs/vue-api-endpoints.md).

Architecture inputs: [S0](../../docs/s0-architecture-performance-baseline.md),
[ADR 0009](../../docs/adr/0009-browser-api-boundary-and-vue-migration.md),
[S4](../../docs/s4-server-boundary.md), and [REST contract](../../docs/api-contracts.md).

## Run

Use the repository's Node 24 and pnpm 11. Install from the repository root:

```sh
pnpm install --frozen-lockfile
pnpm dev:frontend
```

Open `http://localhost:5173/` with the root script (`dev:vue` retains the historical `/vue/` default). Run the standalone API separately with its server environment,
PostgreSQL migrations and seeded identity. Enter that identity's API token in the form.
Vue does not load the root `.env`. Optional app configuration belongs in
`apps/vue/.env.local`; see [.env.example](.env.example).

- `VITE_APP_BASE`: public build-time path, default `/vue/`; must start/end with `/`,
  with only alphanumeric, underscore and hyphen path segments. `/` is also valid.
- `VITE_CCE_API_BASE_URL`: public HTTP(S) API origin, for example `http://localhost:3001`;
  no credentials, path, query or fragment. Leave empty for the Vite/production same-origin proxy;
  direct cross-origin cookie use requires a separate CORS policy. REST, SSE, uploads and media use this origin.
  An empty value uses `/api` on the static gateway, which must route to the standalone API.
- `CCE_API_PROXY_TARGET`: optional Node-side dev/preview upstream, default
  `http://localhost:3001`, targeting standalone API only.
- Cookies use `credentials: include`. Direct cross-origin operation requires explicit
  credentialed CORS and an allowed-origin policy on the API. The existing handlers require
  same-origin mutations; use a same-origin gateway/proxy until the API host supports that policy.
  Never put secrets in `VITE_*`.

```sh
pnpm --filter @cce/vue build
pnpm --filter @cce/vue preview
pnpm --filter @cce/vue typecheck
pnpm --filter @cce/vue lint
pnpm --filter @cce/vue test:coverage
```

The root build/typecheck/test/coverage/lint commands include Vue. Vue tests have a
separate Vite configuration for SFC compilation and are excluded from the root test
runner/TypeScript tools project to avoid duplicate execution and React JSX settings.

## Browser boundary and state ownership

`src/views -> src/data -> fetch /api -> existing HTTP host -> application`

All transport DTOs reuse runtime schemas from `@cce/api-contracts`; the frontend
does not import application, infrastructure, Next, React or Node modules. The build
plugin rejects Node builtins, server packages, server filenames and Vite's browser
external stubs, including transitive imports. Every build produces
`dist/bundle-report.json` with the final chunk sizes, gzip-9 bytes, initial static
import closure and emitted module inventory. It fails above 120,000 initial JS
gzip-9 bytes. Route chunks are excluded from that entry-only budget and reported
separately. Do not publish the report as a public asset; retain it as a build artifact.

Only the authenticated user and bootstrap flag live in the shared session object.
Server resources are route-owned `shallowRef` snapshots; pending/error/filter/form
state belongs to its component. There is no Pinia, query library, persisted client
cache or global Conversation graph. Vue's [performance guidance](https://vuejs.org/guide/best-practices/performance)
supports route splitting and shallow reactivity for large immutable structures.

- Every route component is dynamically imported; conversation lists load only on
  their own route. Project shell identity is keyed by project ID, avoiding a shell
  remount/refetch when changing a project tab. Lists use persisted IDs as keys.
- A request scope deduplicates only simultaneous GETs for the same path, including
  its query string. It is disposed on navigation. Responses are parsed once per
  subscriber, with no permanent cache. Mutations are never deduplicated/retried.
- Both AbortSignal and generation checks prevent stale responses from publishing
  after navigation. Session invalidation cancels all active JSON requests.
- `chat-stream.ts` is an independently importable POST/fetch SSE client, loaded lazily
  by ConversationView. It validates events, handles split UTF-8/CRLF, propagates
  errors, requires a completion event, bounds incomplete frames and cancels/releases
  the reader. ConversationView passes a route-owned AbortSignal; logout unmounts the view. No automatic reconnect or mutation replay.
- MessageList renders bounded pages of 100 in persisted sequence order, using stable
  IDs and memoized message nodes. Its attachments slot is the S7 integration point.
  The server still returns the complete message list; no cursor API is assumed.

## Authentication, errors and styles

Bootstrap calls `GET /api/session` once. Only 401 means anonymous; backend or schema
failures display an error. Login validates the existing token body and calls
`POST /api/session`. The password input is cleared before awaiting the response.
The backend sets its existing encrypted HttpOnly, SameSite=Strict cookie. Logout
cancels work, clears browser identity and calls `DELETE /api/session`. No token,
cookie, server response or identity is written to localStorage/sessionStorage.
RBAC and object/project authorization remain on the server.

Next reconstructs its Request URL using the backend origin. The **loopback HTTP
development/preview proxy** first compares the incoming Origin exactly with the
incoming public Host. Only a match is translated to the backend origin; foreign
origins (including a forged backend origin) become `null`, and absent Origin stays
absent. Existing backend Origin checks therefore still reject them. This adapter is
not a CORS policy or a production authorization boundary. Do not expose Vite publicly.

Route guards manage navigation, not authorization. API errors retain status and
request ID; resource loading/error/empty states allow retry and inaccessible 404s
have a safe message. Vue errors, browser errors, unhandled promises and failed lazy
chunk loads reach a global recoverable error screen. Unexpected exception details
are not rendered. Interpolations remain escaped; no HTML injection rendering.

`src/styles/base.css` copies the small color/radius/font token set from
`apps/web/app/globals.css`, with semantic HTML and visible keyboard focus. It does
not import the complete React workbench stylesheet. Keep token values aligned until
a later shared-style migration can update both consumers together. No CSS framework,
icon library, remote font or shared runtime package is required for this slice.

## Production deployment

Build with the intended `VITE_APP_BASE`. Serve `dist/index.html` and `dist/assets`
under that prefix; SPA fallback applies only to that prefix. Keep `/api/*` and
`/mcp` routed to the existing backend. Use HTTPS, existing security headers/CSP,
`no-cache` for HTML and immutable caching for hashed assets. Retain previous hashed
assets for the rollback window. `vite preview` is a local smoke-test host, not a
production server. The normal Next UI remains available at `/` during coexistence.

The production ingress must retain the existing cookie, canonical public origin and
SSE streaming/cancellation semantics. If the host requires origin translation,
validate the external Origin exactly at the trusted ingress before translation;
never unconditionally overwrite it. Disable buffering/timeouts that truncate SSE.
UI rollback changes the static prefix routing/assets only; API and database remain
unchanged. No deployment cutover is performed by S5.

## Dependency review

New production libraries are Vue 3.5.43 and Vue Router 4.6.4 (MIT, compatible with
Apache-2.0, native TypeScript types, maintained official projects). Vue is required
for this foundation; Router provides nested history routes and lazy imports without
handwritten navigation. Router 4 provides those capabilities without Router 5's
file-route generation dependency tree. Existing Zod/API contracts are reused.
Tests exercise the libraries through the application, and bundle sizes measure
their actual runtime cost. No query/store/UI library is needed.

Vite 8.3.1, the official Vue plugin, vue-tsc and eslint-plugin-vue are app development
dependencies; Vite satisfies Node 24 and the plugin's peer range. pnpm also resolves
the existing Vitest Vite peer to this version. Official
[Vue security](https://github.com/vuejs/core/security) and
[Router security](https://github.com/vuejs/router/security) pages were reviewed;
the former reports a server-renderer advisory (this app uses precompiled client SFCs).
The installed production graph audit reports zero advisories. Full workspace audit
still reports existing development-tool advisories for esbuild 0.27.7 (low) and
undici 8.10.0 (moderate); S5 does not upgrade unrelated tooling. Vite binds to loopback.

## Validation and initial bundle

`pnpm --filter @cce/vue test:e2e` starts the actual Next API host and Vite, for the real session/lifecycle smoke test. The S6 migration flow separately uses
contract-shaped API fixtures to exercise deterministic chat and merge behavior. It requires a migrated **test** PostgreSQL database and a seeded token
(`CCE_E2E_API_TOKEN` or `CCE_SEED_API_TOKEN`). The test creates then archives its own
project through the API. Root `.env` is loaded only by the Node test configuration;
shell environment values take precedence. Credential-bearing tests disable traces
and screenshots. Set `CCE_VUE_PREVIEW=1` after a build to run against production assets.

Recorded on 2026-09-29, Windows, Node 24.15.0 / pnpm 11.22.0:

- PostgreSQL 16.15 in an isolated WSL Docker container: all five existing migrations
  applied from an empty database; identity seeded through the repository command.
- Chromium dev and production-preview smoke tests pass: real login, HttpOnly cookie,
  session reload, project and conversation reads, foreign-Origin rejection, logout,
  protected-route redirect and browser 404. Browser storage remains empty.
- Unit tests cover request dedupe/cancellation, stale resource suppression, session
  races, status/schema/network failures, route guards, config, proxy and module
  boundaries, SSE framing/error/abort. Core coverage thresholds are 80% for lines,
  branches, statements and functions; SFC rendering is exercised by browser tests.
- The configured initial JS budget is a foundation budget, not an S0 performance
  improvement claim: the Vue slice has substantially fewer features than the Next
  workbench. Full application comparison requires equivalent migrated behavior.

| Production asset set                                          | Raw bytes | gzip-9 bytes |
| ------------------------------------------------------------- | --------: | -----------: |
| Initial entry JS (Vue, router, DTO validation, session shell) |   192,468 |       61,639 |
| Login route JS, loaded after bootstrap                        |     1,085 |          666 |
| All emitted JS, including every lazy route                    |   197,963 |       65,087 |
| Initial CSS                                                   |     1,889 |          852 |

The report is computed after bundle generation and was compared against the actual
on-disk bytes. Initial anonymous login therefore adds the 666-byte route to the
entry, rather than loading all routes. Sizes use gzip level 9, not Vite's default
compression display and not measured browser transfer timings.

The full unit/coverage run passes 479 existing tests plus 53 Vue tests. Vue core
coverage: 96.44% statements, 88.23% branches, 92.85% functions, 100% lines. Root lint,
typecheck and production builds pass, and frozen installation succeeds. Changed
files pass formatting. The repository-wide format gate still reports pre-existing
files outside S5. The existing `pnpm test:integration` runner fails before execution
because root `tsx` and `scripts/run-postgres-tests.mts` are missing; the full backend
integration suite is not claimed as passing. Empty-database migrations and the real
Vue HTTP/browser flow above were run independently and passed.

See `dist/bundle-report.json` after building for exact current byte counts. Browser
graph checks include the initial and lazy route chunks; no Node-only dependencies
are present in the checked graph.

S7 attachment rendering, upload behavior, preview limits, verification and bundle
measurements are documented in [ATTACHMENTS.md](ATTACHMENTS.md).
