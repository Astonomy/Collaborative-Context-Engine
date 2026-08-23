# CCE PostgreSQL adapter

`@cce/database` implements the application repository ports with Drizzle ORM and PostgreSQL 18.
PostgreSQL remains the source of truth; database JSON is parsed through the domain schemas when it
is read.

## Invariants

- Every project-owned row includes `project_id`.
- Project-owned relationships use composite foreign keys, including ContextItem provenance links to
  its commit, conversation, and messages.
- `projects.head_commit_id` and `conversations.branch_id` use initially deferred foreign keys so their
  two-row aggregates can be created atomically.
- Context commits, commit changes, context item versions, provenance, deltas, and audit events are
  append-only at the database level.
- An unfinished message may advance through its delivery states; a terminal message cannot be
  rewritten or deleted.
- Message sequence allocation locks the owning conversation row. Project HEAD changes compare the
  expected commit and version before updating.

## Commands

Set `DATABASE_URL` to a PostgreSQL connection string, then run:

```sh
pnpm --filter @cce/database migrate
pnpm --filter @cce/database seed
```

The migration runner applies `migrations/0001_initial.sql` in a transaction, serializes concurrent
runners with a PostgreSQL advisory lock, and records a SHA-256 checksum. The seed command requires
`CCE_SEED_USER_EMAIL`, `CCE_SEED_USER_NAME`, and `CCE_SEED_API_TOKEN`; it stores only the token's
SHA-256 digest and is idempotent for the same email and token.

Integration tests use the exact `postgres:18.6-alpine3.24` image through Testcontainers. A missing
container runtime is a test failure, not a skipped test.
