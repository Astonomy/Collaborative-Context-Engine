# Development

Prerequisites are Node.js 24 LTS, pnpm 11.22.0, and Docker/Compose for PostgreSQL-backed work. Enable
Corepack, install the frozen lockfile, copy `.env.example` to `.env`, and replace the example token and
session secret.

The root `.env` is a checked-in template location, not an implicit runtime loader. Export its values
into the current shell (or configure the IDE/process launcher) before invoking the database CLI or Web
process. This keeps configuration loading explicit and avoids adding a second dotenv implementation.

```sh
corepack enable
corepack prepare pnpm@11.22.0 --activate
pnpm install --frozen-lockfile
docker compose up -d --wait
pnpm --filter @cce/database migrate
pnpm --filter @cce/database seed
pnpm dev
```

`pnpm validate` is the deterministic, Docker-free quality gate: format check, zero-warning lint,
typecheck, coverage, and production build. It intentionally reports that PostgreSQL integration and
Playwright E2E were not run. `pnpm verify:full` adds both external layers and is the complete local gate.

The integration suite uses Testcontainers with `postgres:18.6-alpine3.24`; no SQLite substitute and no
skip-on-missing-Docker behavior exists. Developers without a Docker-compatible runtime can still run
`pnpm validate`, but cannot claim the complete Definition of Done. E2E also requires a Chromium binary,
installable with `pnpm exec playwright install chromium`.

ESLint 9.39.5 is intentionally pinned while the selected Next.js ESLint configuration and its plugin
graph declare ESLint 9-compatible peer ranges. Upgrading to ESLint 10 via peer overrides would make the
quality gate unsupported and less reproducible. ADR 0006 records the upgrade condition. Formatting
commands remain deliberately separate from business changes.

Migrations are forward-only committed SQL. Never edit a migration after it has been applied: the runner
records and verifies its SHA-256 checksum. Do not use schema push against shared/production databases.
Stop the development database with `docker compose down`; add `--volumes` only when intentionally and
irreversibly discarding local data.
