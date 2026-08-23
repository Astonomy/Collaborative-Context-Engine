# Implementation phases

The dependency-ordered delivery plan is:

1. Architecture baseline: workspace, ADRs, AGENTS, quality gates, CI, PostgreSQL environment.
2. Domain and deterministic Context Engine with unit/property tests.
3. PostgreSQL migrations, repositories, atomic commit path, and integration tests.
4. Application services, project-scoped RBAC, REST contracts, and API tests.
5. Provider/chat/extraction path with fake contract tests and eval fixtures.
6. Context and merge review UI with component tests.
7. Small approval-aware Agent workflow that only proposes Deltas.
8. Golden-path and permission E2E, clean install/build/migration verification.

Agent frameworks, RAG/pgvector, autonomous coding agents, enterprise SSO, separate vector/graph databases, and microservices remain intentionally outside the MVP until measured needs justify an ADR.
