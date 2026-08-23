# Collaborative Context Engine engineering rules

## Non-negotiable principles

1. Conversation is evidence, not project state.
2. Persisted PostgreSQL context is the source of truth.
3. Every semantic state change produces an immutable `ContextCommit`.
4. Every `ContextItem` preserves Project → Commit → Conversation → Message → actor provenance.
5. AI proposes high-risk changes; an authorized human commits them.
6. Prefer validation, exact comparison, deterministic rules, and normalization before model reasoning.
7. Domain and context-engine code must remain model-provider and infrastructure independent.

## Architecture and dependencies

- Primary language: strict TypeScript on Node.js 24. Python belongs only behind an external model-runtime API.
- Package manager: pnpm 11; do not add another lockfile or package manager.
- The repository is a modular monolith: `apps/web` → `packages/application` → domain ports; infrastructure implements ports.
- `packages/domain` imports no application, database, web, or provider implementation.
- `packages/context-engine` may import domain and shared only. It never imports a provider SDK or database adapter.
- All remote model access goes through `ModelProvider`.
- REST is the public application API. Do not introduce GraphQL or a second API paradigm without an ADR.
- PostgreSQL-specific behavior must be tested against PostgreSQL, never substituted with SQLite.

## Required commands

- Install: `pnpm install --frozen-lockfile` (use `pnpm install` only when intentionally updating dependencies).
- Format: `pnpm format:check`
- Lint: `pnpm lint`
- Typecheck: `pnpm typecheck`
- Unit tests: `pnpm test`
- Coverage: `pnpm test:coverage`
- PostgreSQL integration tests: `pnpm test:integration`
- E2E: `pnpm test:e2e`
- Production build: `pnpm build`
- Full local quality gate: `pnpm validate`

## Dependency and security policy

- Before adding a production dependency, verify necessity, maintenance, security history, types, testability, runtime impact, and license compatibility with Apache-2.0.
- Avoid GPL/AGPL dependencies unless a documented license review explicitly approves them.
- Validate all API input, environment values, database JSON, and model output at runtime.
- Never commit real credentials. Keep `.env` ignored and maintain `.env.example`.
- Enforce project scope and RBAC in application/database code. A prompt is never an authorization boundary.
- Keep raw messages, commits, and audit events append-only. Semantic removal means deprecated/superseded, never history deletion.

## Code, tests, and Git

- Use business-specific names and small cohesive modules; avoid generic `utils`, `helpers`, and `manager` dumping grounds.
- Do not use `any`, `@ts-ignore`, broad lint disables, hidden casts, skipped tests, placeholder success, or hard-coded demo behavior.
- Add behavior and error-path tests with each implementation. A real bug fix starts with a regression test whenever reproducible.
- Preserve user changes and the Apache 2.0 `LICENSE`. Do not rewrite history, force-push, or make unrelated formatting changes.
- Update architecture, API, security, testing, and deployment documentation with behavior changes.

## Definition of Done

Implementation, relevant unit/integration/E2E tests, error paths, documentation, format, lint, typecheck, coverage, and build all pass; migrations are validated from an empty PostgreSQL database; no unresolved placeholder or architecture violation remains.
