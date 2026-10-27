# Standalone attachment delivery

The attachment upload, metadata, inspection and content handlers live in `apps/api`.
The Node HTTP listener and shared application runtime load without Next.js. Next routes
remain compatibility adapters. Start API and Vue with `pnpm dev:standalone`, then open
`http://127.0.0.1:5173/vue/`. `pnpm dev:api` starts only the API on loopback port 3001
(`CCE_API_PORT` overrides it). Use the existing server environment from `.env.example`.
Production requires an absolute private persistent attachment directory.
The standalone host supplies its app directory as the runtime base, preserving the
repository `.cce-attachments` development default used by the existing web host.
A same-origin gateway should route `/api` to this listener and serve Vue assets. The existing Next
deployment, legacy UI and MCP hosting are separate from this attachment migration.

## Audit and preserved contracts

| Boundary         | Implementation and behavior                                                                                                                                               |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Entity/schema    | `packages/domain/src/attachment.ts`, database schema and migration 0005: immutable attachment, composite project/conversation/message FK, append-only events              |
| Storage          | `LocalAttachmentStorage`: private random object identity, incremental checksum/write, maximum 64 KiB read chunks, ranged reads and descriptor cleanup                     |
| Upload           | `POST /api/projects/{p}/conversations/{c}/attachments`: existing raw binary body and filename/client-message headers; attachment and new evidence message bind atomically |
| Metadata         | `GET /api/projects/{p}/attachments/{a}`: validated DTO excludes storage identity                                                                                          |
| Conversation     | `GET /api/projects/{p}/conversations/{c}` returns `attachments[]`; message-list DTO attaches arrays by persisted `messageId`                                              |
| Preview metadata | `GET /api/projects/{p}/attachments/{a}/inspection`: existing bounded server inspection; no separate preview binary endpoint or derivative is invented                     |
| Content          | `GET /api/projects/{p}/attachments/{a}/content`: authenticated storage proxy, full 200 or single byte-range 206                                                           |
| Vue              | Renderer uses server inspection MIME/capability; image uses `img`, MP4 uses `video`, generic files use download cards; existing isolated model viewer remains             |

The display text `Attachment: filename` remains evidence text. It never reconstructs
attachment identity. Binding uses attachmentId, messageId and project/conversation IDs
from persisted records. No raw Message history or semantic ContextCommit behavior changes.
An ordinary text message containing the same display text receives no attachments.

## Authorization, delivery and memory

Every upload authenticates and checks project membership plus active scoped conversation
before storage and again before committing. Every metadata, inspection and content/Range
read authorizes project membership, resolves the attachment and its conversation within
that project, and checks availability. Conversation permissions are the existing project
RBAC policy; this change introduces no alternative ACL. Knowing an ID grants no access.
Outsiders and missing resources follow the existing non-disclosing 404 policy; absent
credentials produce 401. Revocation applies to subsequent content requests.

Signature-detected PNG/JPEG/GIF/MP4 receive their stored MIME and inline disposition.
Other files remain octet-stream downloads, regardless of declared MIME or filename.
All content has private/no-store, nosniff and sandbox CSP. Range responses include
Content-Range, Accept-Ranges, Content-Length and Content-Type. Invalid/unsatisfiable
ranges return 416; If-Range falls back to full 200 because validators are not issued.
WebM remains unsupported under the existing signature/inspection policy.

Upload, storage and HTTP delivery stream with backpressure. Images and videos use
credentialed API URLs directly rather than constructing a complete Blob in JavaScript.
Existing model object URLs retain their cleanup. Neither storage paths nor credentials
appear in DTOs or browser URLs. Private storage must not be mounted as public assets.

## Reproducible proof

Run `pnpm test:e2e:attachments`. The runner migrates an empty PostgreSQL database and
starts **only Node CCE API and Vite/Vue**, with no Next process. Chromium uploads PNG,
JPEG, MP4 and generic attachments, reloads persisted bindings, renders both images and
loads video metadata. It verifies conversation/message DTO relationships, identical
text without a binding, missing resources, cross-project and outsider access, logout
revocation, and MP4 Range 206 with all required headers. PostgreSQL 18.6 and Chromium
passed this test locally on 2026-10-08. Use `TEST_DATABASE_URL` with a maintenance
database named `postgres`, or the runner's Testcontainers default.

Local verification: 514 workspace tests and 140 Vue tests passed with coverage thresholds;
12 PostgreSQL integration tests, 5 standalone browser tests, 7 existing Vue deployment
tests and 4 existing E2E tests passed. Typecheck, lint, production build and attachment
file formatting passed. Full-repository `format:check` still reports 60 unrelated files;
the full quality gate is therefore not green.
