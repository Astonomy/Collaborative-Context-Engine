# Deployment

Vue static assets and the standalone Node API are independent deployment units. Next.js is an
optional legacy host, started explicitly with `pnpm dev:legacy` or built with `pnpm build:legacy`.
No frontend/API/plugin process requires Next. Existing Next source and package scripts remain.

## Development

```sh
pnpm install --frozen-lockfile
cp .env.example .env
# Replace development token/session values and configure DATABASE_URL.
docker compose up -d --wait postgres
pnpm db:migrate
pnpm db:seed
pnpm dev:api       # localhost:3001, independent terminal
pnpm dev:frontend  # localhost:5173, independent terminal
```

`pnpm dev` starts both processes; `pnpm dev:standalone` is its compatibility alias.
`CCE_API_PORT` and `CCE_API_HOST` configure the API listener (defaults 3001/127.0.0.1).
Configure `CCE_API_PROXY_TARGET` in the frontend process when changing API ports.
Vite forwards `/api` and `/mcp` to API, translating only matching browser origins;
foreign origins remain rejected. This proxy is development routing, not an architectural dependency.

## Production

```sh
pnpm build:frontend
pnpm build:api
pnpm db:migrate
pnpm start:api
```

`apps/vue/dist/index.html` and `assets/` can be served by any static host/CDN with SPA fallback.
Do not publish `.vite/` or build reports. The default root build emits Vue at `/`; the unchanged
Vue workspace scripts retain their historical `/vue/` default for legacy staging. Use
`VITE_APP_BASE` consistently for the chosen mount path. `pnpm build` runs only independent builds.

The API JavaScript entry is `apps/api/dist/apps/api/main.js`. The runtime uses the existing `tsx`
loader for extensionless imports and workspace TypeScript exports. Deploy the artifact with the
workspace source packages, workspace links and locked dependencies. It neither builds nor loads
Next. `pnpm start` aliases `start:api`; `start:legacy` preserves the historical runtime command.

For an isolated production artifact, run `pnpm --filter @cce/api deploy --legacy --prod <directory>`
after `pnpm build:api`. Its entry is `dist/apps/api/main.js` inside that directory. The API Docker
target copies only this artifact into a clean Node image, excluding Next/React and web tooling.
`tsx` remains a production loader because workspace exports contain TypeScript. No new external
dependency was introduced; the already pinned loader is explicitly owned by the API package.

Inject validated database/model/session/storage configuration into API. Production requires an
absolute persistent `CCE_ATTACHMENT_STORAGE_DIRECTORY`, outside public/static roots. The API
owns upload, metadata, authorization, binary delivery, MIME, Range and streaming. SIGTERM/SIGINT
abort active streams and close the PostgreSQL pool.

## Images and Compose

```sh
docker build --target frontend -t cce-frontend:<release> .
docker build --target api -t cce-api:<release> .
docker build --target migrator -t cce-migrator:<release> .
docker compose up -d --wait postgres
docker compose --profile tools run --rm migrator
docker compose up -d --build frontend api
```

The frontend image contains static files and nginx; server credentials are never build arguments.
The API image runs as `node`, binds 0.0.0.0 inside the container, and uses a private attachment volume.
`runner` is retained as an alias for the API image target. Compose services are frontend, api,
postgres, plus an opt-in release migration job. Only API/migrator depend on PostgreSQL. Frontend
starts without API and resolves API through Docker DNS at request time. Neither depends on Next.
Model execution remains an external OpenAI-compatible service configured by `MODEL_BASE_URL`.
The local `cce` PostgreSQL password is a development default; set `POSTGRES_PASSWORD` for deployment.

Migrate once per release before rolling out API. Never rewrite applied migrations. Rollback uses
an API release compatible with the forward schema; legacy Next can be started explicitly for UI
rollback. Preserve PostgreSQL and attachment volumes across deployments.

## Reverse proxy and health

`deployment/nginx.conf` implements `/ → Vue`, `/api → API`, `/mcp → API`, preserves paths,
and disables request/response buffering for uploads/SSE. Asset misses return 404; SPA routes
fall back to index.html. Routing does not introduce Vue/API imports of Next.

Terminate public TLS at ingress and set `CCE_API_PUBLIC_ORIGIN=https://cce.example.com` on API.
The listener constructs its Request origin from that validated server configuration rather than
trusting client-provided forwarded headers. Origin checks still reject foreign cookie mutations.
Leave this unset for local HTTP; Compose exposes only loopback host ports by default.
The frontend health endpoint `/frontend-health` checks static hosting independently of API.
`GET /api/health` checks PostgreSQL (`200` available, `503` unavailable), not model availability.

The PostgreSQL pool handles failed idle connections without terminating the API process.
After a database restart, the pool replaces those connections on subsequent requests. It logs
only a fixed diagnostic, without the error/client object or connection credentials. In-flight
transactions can still fail during an outage; this does not automatically replay writes.
The API Docker healthcheck invokes that endpoint using Node fetch.

## Environment and MCP

Root `.env` is a local API/database CLI convenience; production uses runtime secret injection.
Frontend `.env.local` contains browser-safe values only: `VITE_APP_BASE` and `VITE_CCE_API_BASE_URL`.
Leave API base empty for same-origin ingress/Vite proxy. Setting an explicit origin does not enable
cross-origin cookie authorization/CORS; that policy is outside this deployment change.
Never put database/model/storage/session/MCP credentials in `VITE_*` values. Root frontend scripts
do not load the server env file. Docker excludes all real env files from its build context.

The local connector uses `http://localhost:3001/mcp` and `CCE_API_URL=http://localhost:3001` directly.
`CCE_MCP_ACCESS_TOKEN` belongs only to the process launching Codex. API validates its bearer credential
against persisted CCE identity and project RBAC. Hosted ChatGPT requires public HTTPS and OAuth 2.1;
see [MCP deployment](plugins/cce-plugin.md).

## Verification

`pnpm test:e2e:standalone` starts Vue/API, without Next, against an isolated PostgreSQL database.
It covers real cookie login, upload/download, image/video preview, MIME/Range, project isolation,
and review flows. `pnpm test:integration` includes standalone MCP submit and attachment-helper tests
with both Vue and Next absent. `pnpm verify:frontend` audits standalone browser output; CI builds
API/frontend/migrator image targets independently. See [testing](testing.md).

`pnpm test:e2e:decoupling` runs real REST extraction/review/commit, chat SSE, agents and provider
submission flows through standalone API via Vite, without launching Next. See the final
[decoupling acceptance report](vue-api-decoupling.md) for executed results and remaining blockers.
