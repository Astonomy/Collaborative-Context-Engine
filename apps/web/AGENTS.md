# Web application rules

- The web app handles transport and presentation; business invariants remain in application/domain packages.
- Validate every request and response boundary. Authenticate first, then authorize project scope server-side.
- Server-only modules and secrets must never enter client bundles.
- Test user-visible behavior: validation, loading/error/empty states, merge review actions, and permission-sensitive controls.
- Preserve accessibility: semantic controls, keyboard use, focus visibility, labels, and readable contrast.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
