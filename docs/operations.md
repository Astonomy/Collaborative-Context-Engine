# Operations runbook

## Release order

1. Back up PostgreSQL and verify that the most recent scheduled restore test succeeded.
2. Build immutable `migrator` and `runner` images from the same revision.
3. Execute exactly one migration job with `DATABASE_URL`; require a zero exit code.
4. Roll out Web instances with the validated database, session, and model variables.
5. Wait for `/api/health`, then exercise authentication plus a project-scoped read.
6. Observe request failures, database pool saturation, provider failure codes, and merge conflict rates.

The migration runner serializes concurrent attempts with a PostgreSQL advisory transaction lock, but
deployment orchestration still owns ordering. Never repair a checksum mismatch by changing the
`cce_schema_migrations` table or editing an applied SQL file.

## Runtime topology and health

The Web service is stateless outside PostgreSQL. Session cookies contain an authenticated encrypted API
token and expire after eight hours; all replicas for one environment must receive the same protected
`CCE_SESSION_SECRET`. Rotate that secret as a coordinated session invalidation.

`GET /api/health` is suitable for container health and ingress readiness. A healthy HTTP process does
not prove that an external model can answer every configured profile. Track normalized model-provider
error codes separately and alert on sustained authentication, unavailable-model, timeout, rate-limit,
server, malformed-output, or interrupted-stream rates.

PostgreSQL is the canonical-state dependency. Monitor availability, connection count/pool wait,
transaction latency, locks, disk, WAL/archive health, replication lag where applicable, and backup age.
Do not route writes to a replica or silently fall back to another state store.

## Backup and recovery

Back up the full PostgreSQL cluster/database with a method compatible with PostgreSQL 18 and retain the
WAL required by the chosen recovery objective. Recovery testing must confirm more than row counts:

- project HEAD points to a valid linear commit chain;
- current context projection agrees with replayed commit changes;
- commit/item/message/audit append-only protections remain installed;
- provenance links resolve within the same project and conversation;
- API token columns contain hashes, not raw seed tokens.

Restore into an isolated network, migrate only after the restore is verified, and direct application
traffic to it through an explicit failover procedure. The Web container has no durable filesystem state
to restore.

## Incident handling

- **Database unavailable:** stop accepting semantic writes, preserve failing request IDs, restore
  connectivity or fail over through the database runbook, then verify HEAD consistency before resuming.
- **Model provider unavailable:** canonical reads and deterministic review remain valid. Surface the
  normalized 503/429 result; do not synthesize a Delta or mark a model run successful.
- **Stale merge surge:** inspect concurrent branch activity and client retry behavior. A 409 protects the
  canonical HEAD; never bypass the compare-and-swap check.
- **Suspected token exposure:** revoke/replace the stored token hash, rotate relevant credentials, and
  review audit/request metadata. Avoid copying raw prompts or tokens into incident tickets.
- **Migration failure:** the migration transaction rolls back. Keep the application on the compatible
  prior release, inspect sanitized logs, correct the new forward migration before retrying, and do not
  alter an already-recorded migration.

## Local and CI operational limits

`pnpm validate` needs no Docker and covers deterministic quality checks plus a production build. It does
not validate PostgreSQL or a browser. `pnpm test:integration` requires a Docker-compatible runtime
because Testcontainers launches `postgres:18.6-alpine3.24`; absence is a hard failure, not a skip.
`pnpm test:e2e` additionally needs Chromium and a migrated/seeded PostgreSQL instance.

GitHub Actions pins Node.js and pnpm, installs the frozen lockfile, runs the Docker-free quality gate,
checks the migration command against a PostgreSQL 18 service, executes isolated PostgreSQL integration
tests, runs Playwright Chromium against a seeded service, and builds the production image without
publishing it.
