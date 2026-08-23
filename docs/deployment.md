# Deployment

CCE deploys as one Next.js Node.js 24 service plus PostgreSQL 18 and an optional external Qwen/vLLM
endpoint. Build production assets with `pnpm install --frozen-lockfile && pnpm build` and run migrations
once before starting compatible application instances.

The repository Dockerfile pins Node.js 24.19.0 and pnpm 11.22.0. Its `runner` target copies the Next.js
standalone server, static/public assets, and Apache-2.0 license into the final image, then runs as the
unprivileged `node` user. Its `/api/health` check uses Node's built-in `fetch`; no shell utility or
provider request is required for the database-aware readiness check.

The monorepo standalone entry point is `apps/web/server.js` inside the final image; matching static and
public assets live below `apps/web/.next/static` and `apps/web/public`. The Dockerfile preserves this
layout rather than assuming a single-package root output.

```sh
docker build --target migrator -t cce-migrator:<release> .
docker build --target runner -t cce:<release> .
```

Run the `migrator` image once with only `DATABASE_URL`, wait for success, then roll out `runner` with all
validated runtime variables. Do not run a migration command independently from every replica. Rollback
means deploying application code compatible with the already-forward schema; applied migration files
are immutable and checksum-verified.

Required production controls:

- TLS at the ingress and restricted database/model networks.
- Unique `CCE_SESSION_SECRET`, database credential, and provider credential from a secret manager.
- PostgreSQL backups with tested restore, monitoring, connection limits, and supported minor updates.
- Health/readiness checks that do not expose sensitive dependency details.
- One migration job per release; no automatic schema push from each replica.
- Log retention and access controls appropriate for project metadata.
- Run the application with a read-only root filesystem where the platform permits it; Next standalone
  does not require persistent local storage.
- Route orchestration health checks to `/api/health` and keep detailed dependency failures in protected
  logs/metrics rather than public responses.

The development Compose file is not a production topology. GPU/vLLM deployment is intentionally independent from the CCE application image.
