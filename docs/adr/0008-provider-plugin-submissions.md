# ADR 0008: Provider plugin submissions use expiring previews

- Status: Accepted
- Date: 2026-09-09

## Context

OpenAI's documented plugin architecture can expose Skill-guided MCP tools in ChatGPT and Codex, but it does not promise privileged raw access to a provider's conversation database. Hosted authenticated MCP plugins use OAuth 2.1; local Codex HTTP MCP servers can use a bearer token. The repository has CCE API-token authentication but no public deployment URL or OAuth authorization server.

## Decision

CCE accepts a provider-neutral, runtime-validated submission containing only invocation-supplied messages. `chatgpt` and `codex` inputs normalize to the existing External Conversation IR as `chatgpt-plugin` and `codex-plugin`. No provider SDK or private endpoint enters Domain, Context Engine, or the import application service.

Preview and submission are separate. Preview stores a project- and actor-scoped confidential plan for 15 minutes, reports deterministic counts/warnings and exact normalized-content duplicate identity, and creates no evidence or semantic state. New previews opportunistically delete expired previews in the same project; preview rows cannot be updated. Submission rechecks RBAC and project state, consumes the server-side plan, and uses the existing transaction to write Conversation/Message evidence, the append-only manifest, and an AuditEvent. It never writes ContextItem, ContextDelta, or ContextCommit.

The MCP submit tool is accurately marked as a non-read-only, non-destructive, idempotent create: it appends evidence but does not overwrite or delete state. Annotations do not replace CCE authorization or the Skill's post-preview confirmation. No deep link is returned until the Web application has stable per-conversation routing.

The checked-in connector uses a separate CCE bearer token from an environment variable for local Codex. Hosted ChatGPT remains deployment-gated on a real public HTTPS URL and CCE-issued OAuth 2.1 flow; the integration does not weaken authentication or misuse an OpenAI token to simulate readiness.

## Consequences

Official ChatGPT JSON export remains the preferred bulk and higher-fidelity path; ZIP upload support was subsequently removed. Plugin captures remain unchanged, may be partial, and retain non-text blocks as provenance metadata rather than Message text. Codex support is limited to content a supported surface actually supplies; no local transcript or export format is assumed. Future provider surfaces can reuse the IR and application transaction without adding persistence paths.

The MCP transport uses the official TypeScript SDK pinned at 1.30.0. It is MIT-licensed, supplies the runtime schemas, Streamable HTTP transport, and linked in-memory test transport needed here, and is confined to the provider-facing package; core Domain and Context Engine packages do not import it. The locked production graph has no known audit findings as of this decision.
