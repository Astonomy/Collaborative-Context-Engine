# Testing strategy

Scope C adds a real PostgreSQL idle-connection recovery regression: terminate only the test's
own backend, then verify a fresh connection reads the same persisted project. A unit regression
checks that pool errors neither crash the process nor log connection secrets. The controlled
Compose PostgreSQL restart and browser persistence evidence are recorded in
[final acceptance](verification/final-decoupling-acceptance.md).

Final Vue/API acceptance: `pnpm test:e2e:decoupling` runs real PostgreSQL-backed REST conflict,
extraction, commit, chat SSE, agent persistence and provider submission flows with standalone API
and Vue only. Combine it with `pnpm test:e2e:standalone` for browser auth/media/upload and
`pnpm test:integration` for MCP/plugin submissions. `node scripts/audit-runtime-dependencies.mjs`
checks production workspace dependencies, API imports, Vue build modules and the plugin endpoint.
Legacy E2E commands intentionally retain Next coverage and cannot prove standalone readiness.
Executed acceptance results are in [vue-api-decoupling.md](vue-api-decoupling.md).

The default `pnpm test` gate is deterministic and Docker-free. PostgreSQL integration and Playwright
E2E are separate required CI jobs, not silently skipped tests. This separation keeps fast feedback
available on machines without Docker while making external-system evidence explicit.

| Layer                   | Command                 | Purpose                                                                                                                                 |
| ----------------------- | ----------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| Unit/contract/component | `pnpm test`             | Domain invariants, merge rules/properties, application orchestration through in-memory ports, fake provider HTTP contracts, UI behavior |
| Coverage                | `pnpm test:coverage`    | Includes unimported source; stricter targets for domain/context engine                                                                  |
| PostgreSQL integration  | `pnpm test:integration` | Empty migrations, constraints, transactions, rollback, concurrency/isolation, project scope, atomic commits                             |
| E2E                     | `pnpm test:e2e`         | Real Next/PG evidence smoke plus deterministic Chromium chat/extract/review/finalize and Viewer-denial UX                               |

## Layer boundaries

Unit and application tests use deterministic clocks, ID sequences, hashes, scripted providers, and an
in-memory `UnitOfWork`. They verify domain and orchestration behavior but do not make claims about SQL,
locking, JSONB, foreign keys, or transaction isolation.

The integration runner uses the exact `postgres:18.6-alpine3.24` image with Testcontainers by default,
or `TEST_DATABASE_URL` pointing to a PostgreSQL maintenance database named `postgres`. It creates a
fresh `cce_test_<uuid>` database, migrates it, then drops only that generated database. The suite verifies
PostgreSQL 18.6. It exercises PostgreSQL-only constraints, composite project scoping,
append-only triggers, rollback, message sequence serialization, compare-and-swap HEAD updates,
provenance integrity, repository round trips, and migration checksum replay. SQLite is not an accepted
substitute. A missing or inaccessible container runtime fails setup; no test is conditionally skipped.

The same runner powers `pnpm test:e2e` and `pnpm test:e2e:vue`: unique test identities, an isolated
attachment directory, and a deterministic local HTTP model runtime are created and cleaned up.
Existing application databases and `.env` credentials are not modified. `tsx` is explicitly available
at the root using the version already pinned by the database package.
For production browser verification set `CCE_E2E_PRODUCTION=1` after `pnpm build`. The Vue suite now
uses the default Next HTTP host and its packaged assets, rather than a separate Vite preview server.
`PORT` and matching `CCE_E2E_BASE_URL` can select an unused port for isolated test servers.
Production Secure cookie actions in tests run in the browser; setup/assertion HTTP calls use scoped
Bearer credentials. Do not disable Secure cookies to make a loopback HTTP test pass.
`CCE_VUE_MEDIA_PREVIEW=1 pnpm --filter @cce/vue test:media` measures built media components with fixtures.
Start production Next on port 3107 and Vue preview on 4173, then run `pnpm test:performance` with no
concurrent builds/tests. Raw measurements live in `docs/verification`. See [S8](s8-integration-verification.md).

CI additionally exposes a PostgreSQL 18 service and runs the migration CLI against it before the
isolated Testcontainers suite. This independently covers release-command wiring and hermetic repository
tests. Playwright uses a seeded PostgreSQL service for a real session → project → conversation → message
→ context smoke path through Next.js routes. Its wider chat/extract/merge/finalize browser flow uses
strict transport fixtures, so the deterministic E2E gate never calls a remote model. Those fixtures do
not replace the real route/PG smoke or repository integration layer.

## Coverage and determinism

Target line/function/statement/branch coverage is 90% for Domain; 95% lines/functions/statements and
90% branches for Context Engine; 85% lines/functions/statements and 80% branches for Application and
Model Provider; and 80% overall. Coverage includes unimported production source and excludes test files
and re-export-only index modules. Targets measure behavior rather than encourage snapshots or broad
exclusions.

Property tests fix a repeatable seed in CI and report shrink paths. Every confirmed bug receives a focused regression test before its implementation fix when reproducible.

Conversation import parser tests use deterministic synthetic ChatGPT JSON fixtures, verify ZIP rejection, and never access a provider or the network. Application tests verify preview/confirmation separation, RBAC, idempotency, provenance, audit, and that Project Context HEAD is unchanged.

Provider-plugin tests use the official MCP SDK's linked in-memory transport. They verify the three tool contracts, evidence-summary previewing, unchanged material-reference retention, truthful read/write annotations, malformed and oversized payload rejection, unknown projects, duplicate submission, preview expiry, rollback, provenance, and unchanged Context HEAD without an OpenAI account. The PostgreSQL integration suite drives an MCP call through the real application service and repositories after migrating an empty database, then verifies project isolation, persisted manifest/message evidence, and append-only enforcement. A separate manual smoke procedure is documented in [CCE plugin](plugins/cce-plugin.md) and is never reported as executed unless a real client/account was used.

The plugin's header helper has a dependency-free Node test at `plugins/cce-conversation-submission/scripts/cce-auth-headers.test.mjs`. It verifies process-environment token loading and rejects missing or malformed values without exposing them. Run `node --test plugins/cce-conversation-submission/scripts/*.test.mjs`. PostgreSQL integration tests in `tests/integration/standalone-mcp.test.ts` run real MCP HTTP and local binary helper calls with only the standalone listener, covering text, byte-for-byte attachment download, invalid token, unauthorized project, duplicate submission, provenance and unchanged Context HEAD.

Provider delta regression tests verify successive submissions reuse the Conversation/Branch, retain original messages and material references, allocate continuous sequences, and persist separate immutable manifests. They cover retries, stale predecessors, project/actor/provider isolation, archived targets, and rollback. The MCP contract exercises an append preview and submit; the PostgreSQL integration suite verifies concurrent identical submissions, predecessor JSONB lookup, unchanged prior evidence, and unchanged Context HEAD.

Real Qwen/vLLM smoke tests and AI evals are opt-in; ordinary tests never call a paid or remote model. Eval fixtures record dataset, prompt, provider, model, and version and report extraction precision/recall/type/source accuracy plus merge conflict precision/recall and false-auto-merge rate.

`pnpm validate` stops after the Docker-free gate. `pnpm verify:full` is the complete local command. On a
machine without Docker, report the external-layer limitation rather than describing `validate` as full
verification; CI remains the authoritative execution environment for PostgreSQL integration and E2E.

## S4 server boundary

Run `pnpm exec vitest run apps/api apps/web/server packages/api-contracts` for framework-neutral HTTP contracts and adapter parity, and `pnpm exec vitest run tests/unit/application` for use cases. See [S4 test coverage and limits](s4-server-boundary.md).

## S6 Vue product migration

S6 adds Vue component tests for role/archival gates, agent approval/rejection, stale HEAD/409, and bounded evidence rendering. apps/vue/tests/migration.spec.ts exercises the full proposal-to-commit browser journey with contract fixtures. session.spec.ts tests real PostgreSQL-backed lifecycle actions. Run `pnpm --filter @cce/vue test:coverage` and `pnpm test:e2e:vue`; `CCE_E2E_PRODUCTION=1` selects production hosting. See [S6](s6-ui-migration.md).

The default deployment suite verifies `/` enters Vue, nested routes reload, the HTML CSP allows
image Blobs/media/workers, missing production assets return 404, `/mcp` remains authenticated, and
`/legacy` remains available. The existing attachment lifecycle test now runs through the same host.
Legacy golden-flow tests explicitly target `/legacy`; API/PG semantics remain separately covered.

## Server runtime composition

`tests/unit/server-runtime.test.ts` validates composition in a plain Node subprocess without Next, configuration failures and application/RBAC wiring parity. PostgreSQL behavior remains covered by real PostgreSQL integration tests. See [server composition](server-runtime-composition.md).

Authentication runtime and transport security: see [auth runtime audit](auth-runtime-audit.md).

# Vue standalone API boundary checks

Vue unit tests cover configured API origins, response schemas, credentialed SSE and
structured attachment rendering. The source boundary test rejects legacy runtime imports
and Next host configuration. Existing real-backend E2E suites still start the legacy host;
they do not establish standalone deployment readiness. See [remaining dependencies](vue-api-endpoints.md).

See [standalone attachment delivery](standalone-attachments.md) for the audited
attachment chain, authorized streaming/MIME/Range behavior, independent API/Vue
startup and PostgreSQL-backed browser verification without Next.js.

Standalone attachment upload, metadata, authorized streaming delivery and Vue previews are documented in [Standalone attachment delivery](standalone-attachment-delivery.md).

# Standalone streaming verification

The build recovery checks are recorded in [H2 build recovery](verification/h2-build-recovery.md).
`pnpm build:api` removes API and shared-package `dist` directories before building all
13 TypeScript project references and the API. `pnpm build:frontend` removes Vue `dist`
before typechecking and invoking Vite. These commands regenerate outputs without relying
on incremental artifacts from earlier builds. Shared package exports intentionally point
to TypeScript source; Node development, production and loader regression checks use
`--import tsx`. Import `@cce/database` or `@cce/database/runtime`, rather than the
unexported `@cce/database/index.js` subpath. Server-only exports use `browser: null`
with Node entry conditions, verified by `tests/unit/workspace-build.test.ts`.

See [standalone streaming](standalone-streaming.md#verification) for real HTTP,
Vue terminal/timeout tests and the final frontend origin audit.

## Independent deployment acceptance

`pnpm test:e2e:standalone` runs PostgreSQL-backed Vue/API tests without a Next process:
A (Vue + API with Next stopped) and D (image/video previews with Next stopped).
`pnpm test:integration` includes `standalone-mcp.test.ts`, where no Vue/Next server starts:
B (API/MCP without Vue) and C (MCP preview/submit and attachment uploads without Next).
`apps/api/http-server.test.ts` covers binary/SSE forwarding, disconnect/shutdown/timeout,
and fixed HTTPS ingress Origin validation. CI builds separate API/frontend/migrator image targets.
Historical `test:e2e` and `test:e2e:vue` still explicitly use `dev:legacy`; they test compatibility.
