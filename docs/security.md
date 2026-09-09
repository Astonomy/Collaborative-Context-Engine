# Security

- Authenticate requests with opaque API tokens stored only as SHA-256 hashes; browser sessions use HttpOnly, Secure-in-production, SameSite=Strict cookies.
- Authorize every use case and query within a Project. Child resources load by `(projectId, resourceId)` to resist IDOR.
- Viewers read; Editors create conversations/messages/deltas and review low-risk work; Owners manage members and approve high-risk semantic changes.
- Validate HTTP input, environment configuration, database JSON, and model output. Never trust client/model actor, project, role, status, risk, approval, or provenance fields.
- Keep credentials and provider endpoints server-side. Normalize provider errors and do not log authorization headers, tokens, prompts, or raw confidential model output by default.
- Use parameterized SQL, explicit project-scoped foreign keys, database constraints, and atomic transactions.
- Raw evidence, commits, item versions, and audit events are append-only. Archive is distinct from deletion; privacy redaction requires an explicit future retention design.
- Conversation imports are untrusted: bounded in-memory ZIP parsing rejects traversal, encryption, unsupported layouts, excessive entries/expansion, malformed UTF-8, and malformed JSON. Import content is not logged.
- MCP captures are untrusted and potentially confidential. Runtime schemas cap the request at 8 MiB, 2,000 messages, 100 content blocks per message, 1 MiB of text per message, and 64 KiB of aggregate metadata. Preview records are actor/project scoped, expire after 15 minutes, cannot be updated, and are opportunistically removed after expiry; submit rechecks RBAC and active-project state.
- MCP tool annotations and Skill instructions are defense-in-depth UX signals, never authorization. The CCE server resolves the bearer/cookie to a CCE user and enforces `conversation:import`; it does not accept an OpenAI account token, a prompt-supplied identity, or a model-supplied role.
- The local Codex plugin reads a CCE token from `CCE_MCP_ACCESS_TOKEN` in the host environment. Hosted ChatGPT must use a CCE-issued OAuth 2.1 flow behind TLS before deployment; do not publish the localhost/bearer development configuration as a hosted connector.
- Dependencies are pinned and must remain license-compatible with Apache-2.0. CI audits the complete
  lockfile, fails on high/critical advisories, and checks the installed dependency inventory for
  GPL/AGPL, unknown, or unlicensed groups; lower-severity findings remain visible for explicit triage
  rather than being hidden.

The MVP does not claim enterprise SSO, tenant encryption keys, or regulatory deletion compliance. Deploy it behind TLS and an access-controlled network, rotate tokens and session secrets, and back up PostgreSQL.

## Current dependency audit disposition

As of 2026-09-09, `pnpm audit --prod` reports no known production vulnerabilities. Next.js was updated
to 16.3.4 so its patched release and `sharp >=0.35.4` remove the high/critical findings reported against
16.3.2; the development-only ESLint graph is pinned to patched `js-yaml` 4.3.2 through the pnpm workspace
override. The complete development graph reports one low-severity `esbuild` advisory
([GHSA-g7r4-m6w7-qqqr](https://github.com/advisories/GHSA-g7r4-m6w7-qqqr)) through Vitest/Vite. The
affected behavior requires exposing the development server; CCE uses that graph only for local tests
and does not publish a Vite server. Keep the lockfile pinned and adopt the patched transitive release
when Vitest/Vite's supported range includes it.
