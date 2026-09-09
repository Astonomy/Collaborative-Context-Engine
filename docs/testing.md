# Testing strategy

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

The integration suite always starts the exact `postgres:18.6-alpine3.24` image with Testcontainers and
migrates an empty database. It exercises PostgreSQL-only constraints, composite project scoping,
append-only triggers, rollback, message sequence serialization, compare-and-swap HEAD updates,
provenance integrity, repository round trips, and migration checksum replay. SQLite is not an accepted
substitute. A missing or inaccessible container runtime fails setup; no test is conditionally skipped.

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

Conversation import parser tests use deterministic synthetic ChatGPT JSON/ZIP fixtures and never access a provider or the network. Application tests verify preview/confirmation separation, RBAC, idempotency, provenance, audit, and that Project Context HEAD is unchanged.

Provider-plugin tests use the official MCP SDK's linked in-memory transport. They verify the three tool contracts, truthful read/write annotations, malformed and oversized payload rejection, unknown projects, duplicate submission, preview expiry, rollback, provenance, and unchanged Context HEAD without an OpenAI account. The PostgreSQL integration suite drives an MCP call through the real application service and repositories after migrating an empty database, then verifies project isolation, persisted manifest/message evidence, and append-only enforcement. A separate manual smoke procedure is documented in [CCE plugin](plugins/cce-plugin.md) and is never reported as executed unless a real client/account was used.

Real Qwen/vLLM smoke tests and AI evals are opt-in; ordinary tests never call a paid or remote model. Eval fixtures record dataset, prompt, provider, model, and version and report extraction precision/recall/type/source accuracy plus merge conflict precision/recall and false-auto-merge rate.

`pnpm validate` stops after the Docker-free gate. `pnpm verify:full` is the complete local command. On a
machine without Docker, report the external-layer limitation rather than describing `validate` as full
verification; CI remains the authoritative execution environment for PostgreSQL integration and E2E.
