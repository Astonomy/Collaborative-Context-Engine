# S8 — Integration, performance verification and cutover decision

Date: 2026-10-03. Workspace: current mixed S1–S7 implementation, not a clean release commit.
S8 preserves the pre-existing changes. **Decision: do not change the default frontend/deployment.**
Next remains both the server host and the legacy browser rollback path. No Next files were deleted.

Subsequent authorized cutover: [ADR 0010](adr/0010-default-vue-ui.md) changes the default browser to
Vue and moves the legacy UI to `/legacy`. The results and deferred-cutover decision below describe
the original S8 run; current packaging and operations are in [deployment](deployment.md).

## A. Integration results

The domain → PostgreSQL → private local storage → framework-neutral REST → Vue → media preview chain
passes real PostgreSQL 18.6 browser verification, including production frontend/server builds.
Five migrations apply to an empty generated database; the integration suite also verifies checksum
replay, immutable history, composite project constraints, rollback and commit atomicity.

S8 fixed two integration defects, with failing regression tests before implementation:

- Reload lost attachment cards because Vue only retained upload responses in memory. Added authorized
  conversation attachment discovery through the existing repository/application/REST boundary.
  The UI now reloads persisted metadata and associates it with immutable message IDs. No semantic
  state or ContextCommit behavior changed. Loading/error/retry states cover discovery failure.
- A file handle could remain open after the HTTP consumer received its last content-length byte.
  Local storage now closes immediately after the last full/range chunk. Cancellation remains
  idempotent. The regression verifies closure without requesting another iterator chunk.

Also restored the missing PostgreSQL runner and root `tsx` dependency at its already-pinned version.
It creates only generated `cce_test_<uuid>` databases, seeds isolated identities, runs a deterministic
local model HTTP server, uses a temporary attachment directory, and cleans up afterward. It never
migrates the normal application database. `verify:full` now includes Vue E2E.

The real attachment browser journey creates projects/conversation, uploads PNG/MP4/GLB/model weights
and inert script-containing text, reloads, rediscovers metadata, decodes an image, loads video data,
renders the GLB, compares downloaded bytes, checks Range, rejects foreign scope and signs out.
The UI upload itself uses the browser cookie; API setup/assertions use isolated Bearer tokens.

## B. Remaining regressions and verification limits

- No unresolved functional failure in the executed core/attachment suites. Final unit, coverage,
  integration, Next E2E, Vue dev E2E and Vue production E2E runs pass.
- Repository-wide formatting remains failing in **59 pre-existing files**. The initial run had 60;
  S8 formatted the touched Playwright config. Unrelated files were not reformatted. Consequently the
  required aggregate `validate` gate is not green, even though the individual engineering checks pass.
- PostgreSQL emits an existing warning about concurrent queries on one client being deprecated in
  pg 9. Current pinned pg 8 tests pass; this is not reported as a fixed issue.
- Production tests use `next start` and Vite preview on loopback. Next emits the standalone-start
  warning. This verifies production assets/handlers, not Docker standalone layout or real TLS ingress.
- External ChatGPT/Codex plugin UI, a live model runtime, mobile/network throttling, sustained SSE load,
  long-duration memory growth and production concurrency were not measured. Model behavior in E2E is
  deterministic. API/MCP contract and PostgreSQL tests are not a claim of external plugin certification.

## C. Vue / Next performance comparison

Raw data: [30 samples and artifacts](verification/s8-performance.json),
[media sample](verification/s8-media.json), [bundle audit](verification/s8-browser-audit.json).
Reproducible harness: `scripts/compare-frontends.mts`.

Windows, Node 24.15.0, pnpm 11.22.0, Chromium 151.0.7922.34, 1365×900; production builds,
localhost, no CPU/network throttling. Each scenario has five fresh browser contexts. API interception
disables HTTP cache and adds 100 ms to each request. No PostgreSQL/model latency is part of this
synthetic comparison. Server/OS caches are not reset. Final measurement runs without concurrent tests
or builds. Next loads `/`; Vue opens the equivalent conversation deep link, not the projects landing
page. This route difference and reduced initial data scope are part of the implementation comparison.

“Application render” is a MutationObserver followed by two animation frames after all expected visible
message nodes (or the login button) exist. It is a render opportunity proxy, not a compositor/field
metric. FCP is the shell. Locator-ready is a polling upper bound. No p95/INP claim is made from n=5.

| Metric                                                            |               Next |                Vue |
| ----------------------------------------------------------------- | -----------------: | -----------------: |
| All emitted client JS, raw / gzip-9 bytes                         |  929,266 / 258,012 |  319,768 / 104,084 |
| HTML script set incl. Next nomodule, raw / gzip-9                 |  928,871 / 257,728 |   195,794 / 62,909 |
| Modern conversation route actual loaded JS, raw / gzip-9          |  816,277 / 218,208 |   222,294 / 73,574 |
| Login FCP / application render / locator-ready median ms          | 68 / 248.8 / 316.8 | 28 / 171.9 / 228.2 |
| 20 messages FCP / application render / locator-ready median ms    | 68 / 603.6 / 931.8 | 28 / 391.6 / 834.8 |
| 1,000 messages FCP / application render / locator-ready median ms | 72 / 655.6 / 924.7 | 24 / 404.7 / 836.4 |
| 20-message DOM elements / message nodes                           |           216 / 20 |           142 / 20 |
| 1,000-message DOM elements / message nodes                        |      5,116 / 1,000 |          466 / 100 |
| Initial conversation API GETs / dependency stages                 |              7 / 4 |              5 / 3 |
| 20-message post-GC JS heap bytes                                  |          5,514,672 |          4,927,244 |
| 1,000-message post-GC JS heap bytes                               |          7,423,840 |          5,724,464 |
| After conversation → context, 20-message heap bytes               |          5,736,120 |          5,174,432 |
| After conversation → context, 1,000-message heap bytes            |          6,247,240 |          5,231,788 |

Gzip is per-file level 9 offline compression, not measured wire transfer. Vue totals include the
78,460-byte / 20,732-byte gzip model worker. All emitted JS includes chunks unused by a given route.
The legacy nomodule script is excluded from the modern actual-request row on both sides.

Next 20-message sample waterfall: session at 134.7 ms → projects 240.7 →
conversations/context/commits/merges 376.3–377.2 → messages 520.2.
Vue: session 37.8 → project access 187.3 → conversation/messages/attachments 293.8–294.2.
These are sample starts, not median-stage timestamps. Vue still waits for authentication and project
access; its discovery adds one list request but no per-message metadata request. Visible attachments
subsequently request inspection individually. Full message and attachment lists are still transferred.

Vue login loads entry + LoginView. The conversation loads seven JS resources; context/history/merge
and chat stream chunks are deferred. ModelPreview and its worker are absent before opening a model.
Next loads the same six modern chunks for login and conversation; hidden panels are statically included.

Production media fixture sample: image preview ready 65.6 ms, MP4 readyState ≥2 in 162.8 ms,
one-triangle GLB ready 192.3 ms, measured from explicit open actions with Playwright. Image bytes can
already be prefetched, so this is not an image cold-download benchmark. Video performs a byte-range
request. Unsupported weights have no content request or executable preview. Four model opens create
and terminate four workers. Leaving the route revokes all four created Blob URLs (two were already
revoked by reloads). Heap used is 5,889,736 before leaving and 5,927,068 afterward: **not a heap-memory
improvement**. This is one resource-lifecycle sample, not a leak-free longevity proof. Next has no
corresponding media UI; “not available” is not a performance win over Next.

Attribution: conversation gzip drops 66.3%, but framework, build tool, component markup and lazy
boundaries all changed. No controlled framework-only ablation was performed, so the framework share
cannot be quantified. Fewer initial API dependencies come from route/request orchestration. Fewer
large-list nodes come from the 100-message page limit, not an intrinsic Vue guarantee. FCP also compares
different shells. Both retain the full message response; no backend pagination/SQL/provider speedup
was established. Both small-list heaps grow when switching panels/routes, consistent with loading and
retention costs. No tested median regresses, but this is insufficient to promise no production regression.

## D. Security validation

| Case                                       | Evidence / result                                                                                                                                            |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Unauthenticated attachment/list access     | Real HTTP after logout: 401                                                                                                                                  |
| Authenticated nonmember                    | Real metadata, inspection and content requests: 404                                                                                                          |
| Project crossover                          | Real foreign project content and conversation list: 404; composite FK integration passes                                                                     |
| Forged UUID / malformed ID                 | Real missing attachment 404 / malformed ID 400                                                                                                               |
| Malformed MIME / active malicious filename | Real upload returns 422; unit tests also verify byte-signature mismatch and filename normalization                                                           |
| Oversized or interrupted upload            | Application/storage streaming tests enforce 100 MiB and remove partial writes; no 101 MiB browser transfer performed                                         |
| Unsupported model                          | Browser displays inert weights card; no weight content request/deserialization; malformed geometry/worker outputs tested                                     |
| Unsafe rendering                           | Real script-containing text remains inert; download is octet-stream, attachment disposition, nosniff, private/no-store; active extensions rejected           |
| Expiry                                     | No signed preview/download URL exists; every fetch reauthenticates. Existing cookie codec expiration/tampering tests pass; logout denial verified over HTTP  |
| Resource cleanup                           | Worker termination, Blob URL revocation and storage EOF/cancel tests pass                                                                                    |
| Browser server leakage                     | Vue module guard passes; production scan covers Next 10 and Vue 18 JS files including worker; zero forbidden/server markers or configured credential matches |

The artifact scan checks Node fs/zlib/crypto/child_process, database/provider/server-processor markers,
environment names and actual configured credential strings without printing them. It supplements source
and Vue module-graph boundaries; arbitrary obfuscation is outside the proof. No Node parser, database,
server media processor or provider SDK was found in emitted browser code. The GLB parser is intentional,
bounded browser-only worker code; build scripts use Node APIs outside the browser bundle.

## E. Feature parity matrix

| Current repo capability                                  | Vue parity / evidence                                                                                                       |
| -------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| Login/bootstrap/logout, cookie Origin protection         | Real dev + production browser tests pass                                                                                    |
| Project/conversation list/create/rename/archive/reload   | Real lifecycle browser test passes                                                                                          |
| Evidence persistence and sequence/provenance             | PostgreSQL constraints/atomicity tests and real Next HTTP flow pass                                                         |
| Chat POST SSE                                            | Vue browser fixture flow and transport cancellation/error tests; real Next/provider HTTP E2E passes                         |
| Extraction → proposal → preview/review → confirm/commit  | Vue production fixture journey; actual model-stub/application/PG Next flow passes                                           |
| Current projection/history and expected HEAD/idempotency | Vue navigation/component tests plus actual PostgreSQL atomicity/CAS and real HTTP conflict flow                             |
| Viewer/Editor/Owner, archived resources                  | Vue component/UI gates, real HTTP RBAC and attachment outsider rejection                                                    |
| Agent approval/rejection/state                           | Vue component and application/agent tests; not a new live-model browser approval certification                              |
| MCP/provider import/plugin contracts                     | MCP unit/contract and PG-backed provider capture tests; provider-delta real HTTP E2E passes                                 |
| Attachment upload/discovery/reload/download              | Added real Vue browser test, PG storage/binding integration and unit error paths                                            |
| Image/video/GLB/model-file preview                       | Real dev + production browser test and controlled media resource test pass                                                  |
| Member/import/run-list/cancel/reconcile pages            | Neither old Next browser nor required S6 UI has these pages; existing APIs remain tested, no invented UI parity requirement |

## F. Remaining Next.js dependencies

`apps/web` still supplies the production listener, route/method/Promise-params adapters, HTTP stream
delivery/cancellation, cookie-bearing responses, CSP/HSTS/security headers, MCP facade, process lifecycle
and standalone packaging. `apps/api` has framework-neutral handlers and composition, not a listening
server. React/Next UI, package/build/lint dependencies and Docker entry remain. A deletion plan is
premature until replacement ownership and deployment tests exist. Legacy `/` remains rollback for core
flows; it does not gain the new Vue attachment UI. Forward database migrations are not rolled back.

## G. S8 modified files

Existing S1–S7 changes remain in the worktree; the broad `git diff` must not be attributed to S8 alone.
S8 edits/additions are:

- `package.json`, `pnpm-lock.yaml`, `playwright.config.ts`.
- `scripts/run-postgres-tests.mts`, `scripts/compare-frontends.mts`, `scripts/audit-browser-bundles.mjs`.
- `packages/api-contracts/src/attachment-contracts.ts`.
- `packages/application/src/attachment-repository.ts`, `attachment-service.ts`.
- `packages/database/src/attachment-repository.ts`.
- `packages/storage/src/local-attachment-storage.ts`, `local-attachment-storage.test.ts`.
- `apps/api/handlers/projects/[projectId]/conversations/[conversationId]/attachments/route.ts` and
  the matching `apps/web/app/api/.../attachments/route.ts`.
- `apps/vue/src/views/ConversationView.vue`, `apps/vue/src/migration.test.ts`.
- `apps/vue/playwright.config.ts`; Vue tests `attachment-lifecycle.spec.ts`, `migration.spec.ts`,
  `multimedia.spec.ts`, `session.spec.ts`.
- `tests/unit/application/attachment-service.test.ts`, `tests/integration/database.test.ts`,
  `tests/e2e/provider-delta.spec.ts`.
- `docs/api-contracts.md`, `architecture.md`, `deployment.md`, `security.md`, `testing.md`,
  this report and `docs/verification/s8-{performance,media,browser-audit}.json`.

## H. Exact validation commands and results

Commands run from the repository root, using PowerShell. PostgreSQL 18.6 was provided by a dedicated
WSL Docker container on port 15432. `TEST_DATABASE_URL` was set to that instance's `/postgres`
maintenance database; generated test credentials are not persisted in this report or `.env`.

| Command                                                                    | Final result                                                            |
| -------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| `pnpm install --frozen-lockfile`                                           | Pass; 15 workspace projects, lockfile policies pass                     |
| `pnpm test:coverage`                                                       | Pass: 481 root + 131 Vue tests                                          |
| `pnpm typecheck`                                                           | Pass, including extracted API and Vue                                   |
| `pnpm lint`                                                                | Pass, zero warnings                                                     |
| `pnpm build`                                                               | Pass, TypeScript + Next + Vue production builds                         |
| `pnpm test:integration`                                                    | Pass: 12 PostgreSQL 18.6 tests, all five empty-DB migrations and replay |
| `pnpm test:e2e`                                                            | Pass: 4 Next/core/provider tests; real DB + deterministic model server  |
| `pnpm test:e2e:vue`                                                        | Pass: 5 dev browser tests                                               |
| `$env:CCE_E2E_PRODUCTION='1'; $env:CCE_VUE_PREVIEW='1'; pnpm test:e2e:vue` | Pass: 5 production browser tests                                        |
| `$env:CCE_VUE_MEDIA_PREVIEW='1'; pnpm --filter @cce/vue test:media`        | Pass: production media browser test and resource measurements           |
| `pnpm test:performance`                                                    | Pass: 30 samples, zero page errors                                      |
| `pnpm verify:browser-bundles`                                              | Pass: 28 emitted JS files                                               |
| `pnpm format:check` / `pnpm validate`                                      | Fail at existing repository formatting; not claimed green               |

Production benchmark servers: in `apps/web`,
`node --import ../../scripts/load-root-environment.mts node_modules/next/dist/bin/next start --port 3107`;
in `apps/vue`, `node node_modules/vite/bin/vite.js preview --host 127.0.0.1`.
Format generated JSON with `pnpm exec prettier --write docs/verification` after regenerating measurements.
Root coverage: statements 91.51%, branches 84.07%, functions 96.67%, lines 92.03%.
Vue configured coverage: statements 97.11%, branches 88.45%, functions 95.65%, lines 99.76%.
Coverage scope excludes database (covered by PG integration) and does not imply full SFC render coverage.

Earlier failures were investigated rather than omitted: missing runner/tsx, inaccessible PostgreSQL,
stale project GET test schema, loopback Origin mismatch, attachment reload gap, EOF handle closure,
HTTP-client Secure-cookie behavior and lazy-preview test scrolling. Final successful runs use the
correct contract/origin and browser cookie transport; security policies were not relaxed.

## I. Cutover criteria

**Not satisfied for production default cutover.** Current required core UI parity, production build,
tested auth/API/SSE behavior, functional suites and measured synthetic medians pass. The aggregate
quality gate is still blocked by existing formatting, and a deployable Vue TLS/SPA/header/API/MCP
ingress with rollback has not been verified. Performance evidence does not cover that deployment or
long-running loads. No default command, Docker entry or public frontend routing was switched.
Keep the documented Next rollback path and resolve these gates before a separate reviewed cutover.
