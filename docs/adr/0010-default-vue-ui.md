# ADR 0010: Vue is the default browser UI

- Status: Accepted by explicit user request
- Date: 2026-10-03
- Supersedes: ADR 0002's browser choice and S8's deferred default cutover, not their backend boundaries

## Decision

The public root redirects to the Vue app at `/vue/`. Keep one deployable Node service: Next hosts
Vue static assets and SPA fallback, REST/SSE and MCP. The legacy React browser moves to `/legacy`.
Next is retained as an HTTP host until those responsibilities have a tested replacement.

Build Vue before Next and package its HTML, hashed assets and worker into the standalone image.
Development uses a supervised Vite process behind the same public host. Production never depends
on Vite preview. Public metadata and binary delivery stay on the existing authenticated API.

## Evidence and verification

S8 established UI parity and isolated PostgreSQL attachment flows. The subsequent real-conversation
diagnosis found that the old default renderer displayed attachment text without requesting metadata,
while the Vue build decoded the same persisted image bytes. The cutover therefore changes delivery
and routing, not persistence or context semantics.

Regression coverage must exercise the root redirect, deep-link reloads, missing assets, image Blob
CSP, worker and video delivery, cookie/Origin behavior, MCP and the legacy rollback route through the
shipped host. Run the Vue suite against that host in development and production, not only Vite preview.

## Rollback and limits

Retain `/legacy` and the previous complete image. Roll back HTML/assets as a release unit, retaining
the session secret, attachment volume and forward database schema. Never duplicate requests during
cutover; drain SSE. External TLS ingress and operational rollout are environment-specific checks.
This decision does not add plugin binary upload or codecs for HEVC playback.
