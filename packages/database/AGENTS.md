# Database rules

- Every project-scoped table and query carries `project_id`; use composite foreign keys where they prevent cross-project references.
- All multi-row mutations and context-head updates run in a transaction.
- Migrations are forward-only, explicit, and safe from an empty database. Do not create destructive migrations without user approval.
- PostgreSQL integration tests cover constraints, rollback, isolation, project scoping, and commit atomicity.
- Store API tokens as hashes and never log secrets or raw authorization headers.
