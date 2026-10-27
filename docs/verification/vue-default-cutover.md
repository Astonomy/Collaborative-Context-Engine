# Default Vue UI and deployment verification

Date: 2026-10-04. This follows the user-authorized cutover in [ADR 0010](../adr/0010-default-vue-ui.md)
and preserves the historical [S8 report](../s8-integration-verification.md).

## Delivered behavior

- `/` opens Vue at `/vue/`; nested routes support direct navigation and reload. `/legacy` retains
  the React workbench. REST/SSE and MCP remain on the same Node host.
- `pnpm dev` supervises Vite and Next. The Vite WebSocket uses `/vue/hmr` so the entry redirect
  cannot intercept its upgrade. `pnpm build` builds Vue first and stages HTML/assets into the Next
  standalone runtime; `pnpm start` and the Docker runner use that runtime.
- Production HTML permits image Blobs, same-origin media and workers. Missing assets return 404,
  missing build output returns 503, and SPA fallback does not handle API/MCP requests. Build reports,
  Vite manifests and private attachment storage are not public frontend artifacts.
- Actual container testing reproduced a same-origin login failure: Next constructed a request URL
  using its internal listening address. Origin validation now compares the protocol and HTTP Host,
  with URL authority as fallback when Host is absent. It ignores forwarded Host and rejects missing,
  foreign, wrong-port and wrong-scheme origins. The regression failed before the fix and passed after.

## Verification environment

PostgreSQL 18.6 runs in WSL Docker. Test databases have generated `cce_test_<uuid>` names, all five
migrations apply from empty, and test identities, attachment storage and model responses are isolated.
The user's application database and attachment directory are not used for test writes.

The production image uses Node 24.19.0 and pnpm 11.22.0. Local Linux tooling uses the available Node
25.2.1. Chromium runs on Windows, against the WSL service over localhost. A temporary external-server
test driver bridges this environment; no platform-specific driver or credentials are shipped.

## Results

The final core coverage run passed 488 tests: 91.51% statements, 84.07% branches, 96.67% functions
and 92.03% lines. The local production build, full TypeScript check and `pnpm lint` also passed.

| Check                       | Result                                                  |
| --------------------------- | ------------------------------------------------------- |
| Vue unit tests and coverage | 131 tests passed; coverage thresholds passed            |
| PostgreSQL integration      | 12 tests passed; five empty-database migrations applied |
| Development Vue E2E         | 7 passed, including the proxied HMR WebSocket handshake |
| Docker production Vue E2E   | 7 passed in 11.2 seconds                                |
| Docker legacy/API E2E       | 4 passed in 4.0 seconds                                 |
| Container build             | Passed with frozen pnpm lockfile and Node 24            |

The production browser suite exercises real cookie login, PostgreSQL upload and metadata discovery,
image decoding, video data, Range responses, GLB worker rendering, byte-for-byte download comparison,
reload, project-scope rejection and logout revocation. Default-route checks cover deep links, CSP,
missing scripts/workers/private build metadata, unsupported methods, MCP auth and `/legacy`.
The legacy/API suite covers the review-to-commit UI, Viewer controls, provider deltas and real
Owner/Editor conflict resolution against PostgreSQL.

The normal local production command was also exercised at `http://localhost:3000`, with
`CCE_ATTACHMENT_STORAGE_DIRECTORY` explicitly set to the existing private repository storage.
Health returned 200. A read-only browser check of the original test Conversation found three
attachment cards and decoded both original images at 2894×4093 after scrolling to their cards and
opening previews. Large images retain the existing click-to-load behavior. No conversation or
attachment records were created or changed by that check.

Docker's original offline install failed because pnpm 11 needed registry policy metadata despite
prefetched package tarballs. The build retains `--frozen-lockfile` and uses the normal cached install;
it does not disable registry policy checks or change dependency versions.

## Limits

Root `pnpm format:check` reports 59 pre-existing formatting failures, also recorded by S8. Files
changed for this cutover pass targeted Prettier checks; unrelated files were not reformatted.
The first cold development browser run exceeded its 30-second timeout on the mounted Windows
filesystem; the development verification uses a 90-second test budget. Linux browser installation
and a Windows browser-server connection were unavailable, so the browser tests run from Windows.

These checks cover the local shipped host, not an external TLS ingress or a remote rollout. Ingress
must preserve public Host/protocol, cookies, Range and SSE. The change does not add plugin binary
upload or support for browser-incompatible HEVC video. See [deployment](../deployment.md) for rollback.
