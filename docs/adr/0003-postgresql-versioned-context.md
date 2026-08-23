# ADR 0003: PostgreSQL versioned context is the source of truth

- Status: Accepted
- Date: 2026-08-23

## Decision

Use PostgreSQL 18 with JSONB. Raw conversation evidence, ContextCommits, ContextItem versions, and audit events are append-only. Each project has a linear canonical commit history and a current HEAD projection:

```text
immutable ContextItem versions -> project_context_entries projection
immutable ContextCommit chain  -> projects.head_commit_id
```

Branches retain a fixed base commit and produce immutable ContextDelta proposals. A merge compares Base, current HEAD, and proposed Delta. Finalization locks the project, verifies the evaluated HEAD, and atomically writes commit, changes, item versions, provenance, projection, audit event, and new HEAD. A separate append-only MergeFinalization row records the operation key and terminal outcome, including `no_changes`, so lost-response retries remain deterministic even when no ContextCommit exists.

Drizzle ORM 0.45.2 with `pg` is used behind repository ports. Generated/handwritten SQL migrations are committed and reviewed; production schema push is forbidden. Drizzle is pre-1.0, so versions are pinned and ORM types do not escape the database package. The selected release includes the fix for [GHSA-gpj5-g38j-94v9](https://github.com/drizzle-team/drizzle-orm/security/advisories/GHSA-gpj5-g38j-94v9).

pgvector is not enabled until semantic retrieval becomes a measured requirement.

## Rejected alternatives

- SQLite cannot verify PostgreSQL constraints, JSONB, locking, or isolation semantics.
- Prisma is mature but requires more raw SQL for PostgreSQL extensions and hides some SQL relevant to CCE atomicity.
- A separate vector database and a graph database add unnecessary sources of truth.
