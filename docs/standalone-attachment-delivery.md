# Standalone attachment delivery audit

Attachment upload, metadata, inspection and content run through `apps/api/main.ts`
without importing Next.js. Start `pnpm dev:standalone` for API on loopback port
3001 and Vue/Vite at http://127.0.0.1:5173/vue/. `pnpm dev:api` starts only the API;
CCE_API_PORT selects its port. Keep the API behind a same-origin reverse proxy
in deployment; Vue's development proxy forwards credentials and translates only
verified same-origin writes. Database, session, model-runtime and private storage
environment values remain server-only. The legacy Next routes are compatibility
adapters of the same handlers, not required for this delivery path.

## Audit and evidence binding

| Layer            | Implementation                                                      | Result                                                                                                  |
| ---------------- | ------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| Entity/schema    | domain attachment.ts, database attachment-schema.ts, migration 0005 | Immutable project/conversation/message binding and deferred composite FK                                |
| Storage          | LocalAttachmentStorage                                              | Private UUID objects, incremental writes/hash, 64 KiB reads, ranged reads and cancellation              |
| Upload           | standalone conversation attachments POST handler                    | Authorizes before streaming and again before atomic Attachment + new Message persistence                |
| Metadata         | standalone attachment GET handler                                   | Runtime-validated DTO excludes storage locator                                                          |
| Content          | standalone attachment content GET handler                           | Authorizes every request before storage access; streams responses with backpressure                     |
| Preview          | standalone inspection GET + content GET                             | Existing contract uses inspection metadata and original bytes; no separate preview-binary route existed |
| Conversation DTO | conversation detail GET                                             | Returns structured attachments[] scoped to conversation                                                 |
| Message DTO      | messages GET                                                        | Joins persisted Attachment.messageId to Message.id; returns attachments[]                               |
| Vue              | AttachmentRenderer, ImagePreview, VideoPreview, FileCard            | Server inspection selects renderer; image/video use authorized URLs, other files use download           |

The inverse persisted Attachment.messageId relationship is the Message's reference
to attachment IDs. There is no filename matching, caption parser, or new mutable
Message field. Upload still creates the existing append-only evidence Message;
its `Attachment: filename` caption is display text only. A plain text Message with
that caption has zero attachments. Attachment uploads do not change context HEAD
or create semantic ContextCommits.

## Unchanged URLs and updated content headers

- POST /api/projects/{projectId}/conversations/{conversationId}/attachments
- GET /api/projects/{projectId}/conversations/{conversationId}/attachments
- GET /api/projects/{projectId}/attachments/{attachmentId}
- GET /api/projects/{projectId}/attachments/{attachmentId}/inspection
- GET /api/projects/{projectId}/attachments/{attachmentId}/content

Content-Type uses signature-validated PNG/JPEG/GIF/MP4 metadata, with inline
Content-Disposition. Other files remain application/octet-stream and attachment
disposition. All responses retain private/no-store, nosniff and sandbox CSP.
Without Range, content streams the full body with 200 and Content-Length.
Single bytes=start-end, open-ended and suffix ranges return 206, Content-Range,
Accept-Ranges: bytes, Content-Length and the same MIME. Unsatisfiable/multipart
ranges return 416. Existing If-Range behavior falls back to full 200.
WebM remains unsupported by the current signature/inspection policy.

All content, inspection, metadata and listings require authenticated project RBAC.
The existing authorization model grants conversation reads through project:read;
conversation IDs and attachment IDs are loaded within project scope. There is no
separate conversation ACL in this repository. Knowing an ID grants no access.
Unrelated-project lookups and outsider membership return 404; no session returns 401. Storage keys, filesystem paths and credentials never appear in public DTOs.

Image previews now use img src directly rather than reading an entire Blob.
Video uses video src with preload=metadata and native Range requests. Neither
allocates an object URL. Existing bounded model previews retain their own cleanup.
The Node listener bridges request and response streams; it does not buffer files.

## Reproducible verification

Run `pnpm test:e2e:attachments`. This suite starts only `dev-standalone` (Vite and
Node API), migrates an empty isolated PostgreSQL database, and tests persisted
PNG/JPEG/MP4/non-media uploads, browser image decoding/video readiness, reload,
Conversation and Message attachment IDs, caption-only messages, storage redaction,
missing IDs, cross-project and outsider access, video Range headers and logout
revocation. It also runs the standalone session and conversation evidence flows.
Next legacy/MCP deployment tests remain in `pnpm test:e2e:vue`.

`TEST_DATABASE_URL` may select a PostgreSQL maintenance database; the runner creates
and removes only a generated cce_test_* database and temporary attachment storage.
`CCE_TEST_MODEL_PORT` selects the isolated fixture server port when 18080 is busy.
No external production dependency or database migration was added by this move.

## Verification result (2026-10-08)

- Standalone browser suite: 5/5 passed in Chromium, using only Vite + Node API.
  PNG and JPEG decoded to naturalWidth=1; MP4 reached readyState >= 2. Video
  bytes=0-3 returned 206, video/mp4, bytes 0-3/size, Accept-Ranges and length 4.
- PostgreSQL integration: 12/12 passed; migrations 0001–0005 applied from empty DB.
- Unit/coverage run: 512 root tests and 140 Vue tests passed; coverage thresholds passed.
- Production build passed (Vue and legacy Next compatibility build included).
- Full `pnpm validate` stops at existing format failures in 60 unrelated files;
  these were preserved. Changed attachment files were formatted separately.
- Broader legacy E2E launch was unavailable: occupied development ports, then
  Windows EPERM on the production Next standalone react symlink. This does not
  affect the passing standalone attachment browser suite.
