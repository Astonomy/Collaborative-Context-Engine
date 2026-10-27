# Security

The default production gateway serves static Vue HTML and proxies REST/SSE and MCP to standalone API. Its CSP permits Blob image
previews, same-origin media and same-origin workers, with no external media origins. The SPA fallback
applies to browser routes; API/MCP errors and missing static assets are not replaced by HTML. Attachment
content keeps its separate inert download headers. Build reports, local uploads and private storage
are excluded from the public Vue artifact and container build context.

- Authenticate requests with opaque API tokens stored only as SHA-256 hashes; browser sessions use HttpOnly, Secure-in-production, SameSite=Strict cookies.
- Authorize every use case and query within a Project. Child resources load by `(projectId, resourceId)` to resist IDOR.
- Viewers read; Editors create conversations/messages/deltas and review low-risk work; Owners manage members and approve high-risk semantic changes.
- Validate HTTP input, environment configuration, database JSON, and model output. Never trust client/model actor, project, role, status, risk, approval, or provenance fields.
- Keep credentials and provider endpoints server-side. Normalize provider errors and do not log authorization headers, tokens, prompts, or raw confidential model output by default.
- Use parameterized SQL, explicit project-scoped foreign keys, database constraints, and atomic transactions.
- Raw evidence, commits, item versions, and audit events are append-only. Archive is distinct from deletion; privacy redaction requires an explicit future retention design.
- Conversation imports are untrusted: only bounded JSON uploads are accepted. ZIP and other file formats, malformed UTF-8/JSON, and excessive input are rejected. Import content is not logged.
- MCP captures, generated evidence summaries, and supplied material references are untrusted and potentially confidential. Runtime schemas cap the request at 8 MiB, 2,000 messages, 100 content blocks per message, 1 MiB of text per message, an 8,000-character summary, and 64 KiB of aggregate metadata. Preview records are actor/project scoped, expire after 15 minutes, cannot be updated, and are opportunistically removed after expiry; submit rechecks RBAC and active-project state. Material references are retained as supplied in the append-only manifest and are never dereferenced by the server.
- MCP tool annotations and Skill instructions are defense-in-depth UX signals, never authorization. The CCE server resolves the bearer/cookie to a CCE user and enforces `conversation:import`; it does not accept an OpenAI account token, a prompt-supplied identity, or a model-supplied role.
- The local Codex plugin uses `http_headers_helper` to read `CCE_MCP_ACCESS_TOKEN` from the client process environment and emit the required Authorization header map. No credential file, prompt, Skill, or checked-in configuration contains the token. The standalone API validates it through the existing hashed CCE identity store and rechecks project RBAC. Hosted ChatGPT must use a CCE-issued OAuth 2.1 flow behind TLS before deployment; do not publish the localhost/bearer development configuration as a hosted connector.
- Provider delta submissions resolve `previousImportId` inside the authorized project and require the same importing user and provider. The server derives the target Conversation from persisted provenance, rechecks its active state on submit, and serializes predecessor validation and sequence allocation. A stale predecessor conflicts instead of creating a separate conversation or overwriting evidence.
- Dependencies are pinned and must remain license-compatible with Apache-2.0. CI audits the complete
  lockfile, fails on high/critical advisories, and checks the installed dependency inventory for
  GPL/AGPL, unknown, or unlicensed groups; lower-severity findings remain visible for explicit triage
  rather than being hidden.

The MVP does not claim enterprise SSO, tenant encryption keys, or regulatory deletion compliance. Deploy it behind TLS and an access-controlled network, rotate tokens and session secrets, and back up PostgreSQL.

## Current dependency audit disposition

As of 2026-09-09, `pnpm audit --prod` reports no known production vulnerabilities. Next.js was updated
to 16.3.4 so its patched release and `sharp >=0.35.4` remove the high/critical findings reported against
16.3.2; the development-only ESLint graph is pinned to patched `js-yaml` 4.3.2 through the pnpm workspace
override. The complete development graph reports one low-severity `esbuild` advisory
([GHSA-g7r4-m6w7-qqqr](https://github.com/advisories/GHSA-g7r4-m6w7-qqqr)) through Vitest/Vite. The
affected behavior requires exposing the development server; CCE uses that graph only for local tests
and does not publish a Vite server. Keep the lockfile pinned and adopt the patched transitive release
when Vitest/Vite's supported range includes it.

## S4 server boundary

The extracted HTTP boundary reads authenticated identity from standard Authorization/Cookie headers. Application still enforces RBAC and project/resource scope. Bearer precedence and v1 session encryption are unchanged; security headers remain owned by the Next host. See [S4](s4-server-boundary.md).

Cookie-authenticated writes require an exact Origin match against the request protocol and HTTP Host.
The Host is required to distinguish the public request authority from the standalone server's internal
listening address. Requests without Host use their URL authority. Forwarded Host does not override this
check. Trusted TLS ingress must preserve the public Host and set the correct protocol; missing and
foreign origins remain forbidden.

## S6 Vue product migration

S6 Vue gates Viewer/archived writes and Owner-only high-risk acceptance/agent approval in presentation. All requests remain subject to existing server RBAC. Responses are schema-validated; message/proposal values render as escaped text, and no evidence or credential is persisted in browser storage. Route disposal aborts work; stream 401 clears identity.

## S8 regression verification

Attachment discovery uses the same membership authorization as content and scopes both project and
conversation IDs in PostgreSQL. No storage key or permanent signed URL is sent to the browser.
Every preview/download reauthenticates; session expiry remains enforced by the existing cookie codec.
Tests cover outsider/cross-project reads, forged IDs, malformed MIME, active filenames, byte limits,
inert text containing scripts, unsupported model fallback and logout denial. The detailed distinction
between unit checks, real HTTP checks and fixture browser checks is in [S8](s8-integration-verification.md).
`pnpm verify:browser-bundles` scans both production client outputs (including the model worker) for
server markers and configured credential values without printing credentials. It supplements the Vue
build module graph guard, not a proof against arbitrary obfuscated secrets. Build-tool `node:zlib`
is permitted only outside emitted browser JavaScript.

## Server runtime composition

`@cce/server-runtime` accepts explicit server configuration and has no browser export. Database credentials, model keys and private storage configuration must stay in the server process. HTTP cookies remain in the API adapter; see [server composition](server-runtime-composition.md).

Authentication runtime and transport security: see [auth runtime audit](auth-runtime-audit.md).

# Vue API origin configuration

`VITE_CCE_API_BASE_URL` is public build configuration, validated as an HTTP(S) origin
without credentials, query, fragment or path. Browser requests include cookies; no API
token is stored as build configuration. Separate-origin deployment requires server CORS
and an explicit allowed-origin policy; current same-origin authentication checks remain
in force. Use a gateway to standalone API until that host policy is implemented.

See [standalone attachment delivery](standalone-attachments.md) for the audited
attachment chain, authorized streaming/MIME/Range behavior, independent API/Vue
startup and PostgreSQL-backed browser verification without Next.js.

Standalone attachment upload, metadata, authorized streaming delivery and Vue previews are documented in [Standalone attachment delivery](standalone-attachment-delivery.md).

# Standalone SSE authentication

POST SSE uses the existing cookie/Origin or Authorization Bearer authentication;
Vue uses ApiClient with credentials included. No URL secrets or new cross-origin
permission are introduced. See [stream authentication](standalone-streaming.md#authentication-and-deployment).

## Independent Vue/API deployment

Default runtime topology is static Vue plus standalone Node API; see [deployment](deployment.md).
Only browser-safe VITE configuration enters Vue. Database/model/storage/session secrets remain in API.
For TLS termination, configure `CCE_API_PUBLIC_ORIGIN` to an exact HTTP(S) origin with no credentials,
path, query or fragment. The API uses this fixed origin, ignores forwarded host/proto for authorization,
and keeps exact Origin validation on cookie mutations. Direct cross-origin cookies/CORS are not enabled.
