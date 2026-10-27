# Framework-neutral server composition

Current deployment (2026-10-08): default scripts build and run static Vue plus independent Node API.
Next is an explicit legacy option. See [deployment](deployment.md); earlier host dependency findings
below describe the migration baseline.

The current workspace already delegates Next runtime access to `apps/api/server/runtime.ts`.
Composition now lives in `packages/server-runtime` (`@cce/server-runtime`). No existing
server package owns this boundary: application owns use cases and ports, while apps/api
owns HTTP transport. Putting infrastructure wiring in application would reverse its dependencies.

## API and ownership

`createApplicationRuntime(environment, workingDirectory): ApplicationRuntime` accepts an explicit
server-side environment record and the host's working directory. It validates PostgreSQL,
model configuration, storage paths and environment mode before returning services. No runtime
singleton or ambient process.env read exists in the package. The host must call `await runtime.close()`
to drain its PostgreSQL pool at shutdown. Instantiation is lazy with respect to PostgreSQL and
model network access; it is not a readiness check.

The package constructs the PostgreSQL pool and UnitOfWork, Qwen/vLLM ModelProvider, private local
attachment storage, media inspector, application services and scoped agent service. Repositories
continue to be constructed inside PostgreSQL transactions by the database adapter. RBAC remains
in application use cases; deterministic context building remains in context-engine, invoked by
ContextService. No schema, authorization policy or extraction/agent behavior changes.

The existing pool settings, including application_name=cce-web, remain for compatibility.
The development storage default remains workingDirectory/../../.cce-attachments; production
requires an explicit absolute CCE_ATTACHMENT_STORAGE_DIRECTORY. A future host must deliberately
choose its working directory or configure the existing storage directory to preserve persisted binaries.

## HTTP host boundary

apps/api/server/runtime.ts retains HTTP session-secret validation, SessionCookieCodec,
Secure cookie mode and the lazy process singleton. apps/web/server/runtime.ts retains its
createWebRuntime/getWebRuntime compatibility exports. Next continues hosting REST/SSE/MCP,
UI, Vue static assets, headers and route dispatch. No routes are moved in this scope.

The runtime package exports no browser entry (browser condition is null), uses ES2023 plus
Node types without DOM, and disallows framework/transport imports through ESLint. DATABASE_URL,
model keys and storage paths remain server configuration. Do not inject this environment record
into frontend configuration or serialize runtime objects to clients.

## Verification and next scope

The Node subprocess test loads the public package through Node + tsx without starting Next.
Additional tests exercise invalid configuration, private production storage, shared UnitOfWork
wiring, context snapshots/messages, RBAC denial, invalid-token rejection and HTTP cookie parity.
The in-memory repository fixture checks application wiring only; PostgreSQL integration remains
on real PostgreSQL.

Next scope should mount the existing apps/api/handlers on an independent Node listener/router:
REST method/path/params dispatch, session authentication and Origin checks, POST chat SSE and
cancellation, attachment upload/list/inspection/content/Range streaming, and MCP GET/POST/DELETE
now in apps/api/handlers/mcp/route.ts; the legacy Next route delegates to it. Preserve the inventory in
[the decoupling audit](vue-next-decoupling-audit.md), including its missing GET/parity findings.
This composition scope does not provide an independent HTTP listener.
