# Vue/API deployment verification

Verified on 2026-10-08 against the current workspace, including its pre-existing migration changes.

| Scenario                             | Result | Evidence                                                                                                                                                        |
| ------------------------------------ | ------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A: Next stopped, Vue + API running   | Passed | `pnpm test:e2e:standalone`: 5 Chromium tests; production nginx static Vue login and reload smoke check                                                          |
| B: Vue stopped, API/MCP running      | Passed | Production frontend container stopped; API health 200 and authenticated MCP `tools/list`; standalone integration server starts neither UI host                  |
| C: Next stopped, MCP submit          | Passed | `tests/integration/standalone-mcp.test.ts`: real PostgreSQL, MCP preview/submit, original attachment bytes and scoped authorization                             |
| D: Next stopped, image/video preview | Passed | Real PostgreSQL attachment lifecycle E2E plus production static Vue JPEG/MP4 upload, preview and reload; actual image naturalWidth and video readyState checked |

## Quality and containers

- `pnpm build`: independent API artifact and Vue static assets, without Next build.
- `pnpm lint` and `pnpm typecheck`: passed.
- `pnpm test:coverage`: 526 root tests, 142 Vue tests, 4 plugin tests; coverage thresholds passed.
- `pnpm test:integration`: 15 tests against PostgreSQL 18.6.
- `pnpm test:e2e:standalone`: 5 tests; historical `test:e2e`: 4 and `test:e2e:vue`: 7 also passed.
- `pnpm verify:frontend`: 22 JavaScript artifacts, no forbidden server dependencies or known credentials found.
- Docker `api`, `frontend`, `migrator` targets built; Compose frontend/API/PostgreSQL health checks passed.
- Migrator applied migrations 0001–0006 to an empty PostgreSQL database.
- Production proxy `/api/health`: 200; `/`: 200; missing asset: 404; unauthenticated `/mcp`: 401.
- Production static page retained media CSP and nosniff headers. API image ran as `node`.

Windows used WSL's Docker with an isolated Compose project and ports 55439–55441.
Test database URLs were process overrides; no user env file was changed. Synthetic verification
identities and uploaded files lived only in the isolated test volume.

Changed files pass formatting. Whole-repository `pnpm format:check` remains blocked by existing
formatting issues outside this change; the complete `pnpm validate` gate is therefore not claimed.
