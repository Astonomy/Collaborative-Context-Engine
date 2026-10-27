# Attachment binary lifecycle (S2)

S2 implements the existing S1 Attachment schema, repository and immutable binding
rules. `AttachmentService` in application owns authorization, byte limits, MIME
policy, idempotency and the transaction. `AttachmentStorage` exposes only `put`
and `open` over `AsyncIterable<Uint8Array>` and internal object identities.
`@cce/storage` implements private local storage using Node APIs. Application and
domain import no filesystem, vendor SDK or Next API. The web routes authenticate,
adapt streams/headers and use the existing API error envelope.

## REST API

- `POST /api/projects/{projectId}/conversations/{conversationId}/attachments`:
  raw binary request body, `Content-Type` (default `application/octet-stream`),
  `X-CCE-Filename` (percent-encoded UTF-8), `X-CCE-Client-Message-Id` (UUID).
  Returns 201 with existing `AttachmentResponse` (no storage locator). It creates
  a **new** user Message with content `Attachment: {normalized filename}` and
  binds the attachment to it atomically. It cannot attach to an existing message;
  there is no client-controlled message ID, actor, storage key or checksum.
- `GET /api/projects/{projectId}/attachments/{attachmentId}`: authorized public
  metadata, using the existing DTO.
- `GET /api/projects/{projectId}/attachments/{attachmentId}/content`: authorized
  streamed bytes. Single closed/open-ended/suffix byte ranges return 206 and
  `Content-Range`; invalid, multi-part and unsatisfiable ranges return 416 with
  the existing VALIDATION envelope and `Content-Range: bytes */size`. An If-Range
  request falls back to the full 200 response because no validator is issued.
  No signed URL is used or persisted.

Bearer authentication and the existing encrypted session-cookie/same-origin
write protection apply. Each upload requires conversation:write (Editor/Owner),
active project and active project-scoped conversation. Authorization is checked
before consuming bytes and again in the binding transaction. The final transaction
locks project then conversation, serializing against project archive/membership
changes and concurrent message allocation. Each read/range request requires
project:read and a project-scoped attachment whose latest lifecycle availability
is available. Missing events fail closed. Revocation affects subsequent requests;
it does not retroactively interrupt a stream already authorized and opened.

## Validation and security

- Hard limit: 100 MiB of **actual streamed bytes**, independent of Content-Length.
  Empty uploads are rejected. Application and local adapter both enforce the cap.
- Filename: NFKC, strip directory components and control/format characters,
  trim and bound to 255 characters; reject dot names and executable/active
  extension segments (including double extensions). Names never form paths.
- Validate MIME syntax; preserve declared and detected MIME separately. Inspect
  a bounded 512-byte prefix for PNG, JPEG, GIF and MP4 signatures. Known signatures
  must match the declaration unless declared application/octet-stream. Unsupported
  image/video signatures are rejected; clients may explicitly submit generic
  binary instead. Unknown non-media types become application/octet-stream/binary.
  Signature recognition is classification, not full codec validation or malware
  scanning. Model formats remain inert generic bytes, never executable inputs.
- Signature-detected PNG/JPEG/GIF/MP4 use their stored Content-Type and inline
  Content-Disposition. Other original files remain application/octet-stream
  downloads. All use UTF-8 encoded names, private/no-store, nosniff and sandbox CSP.
  Delivery is streamed by the standalone API; no derived binary preview is added.
- SHA-256 and size are computed while streaming. Identical bytes receive distinct
  random exclusive object identities; no cross-project deduplication oracle.
  Same clientMessageId + actor + normalized filename + declared MIME + hash/size
  returns the original evidence; changed evidence conflicts. Upload retries still
  transfer and validate bytes. Storage identity is separate from attachment ID.
- Local keys must be server-generated UUIDv4 values, provider local, version 1.
  They cannot contain directories. Writes use exclusive creation and never
  overwrite. Reads check actual size before returning; streaming reads use at most
  64 KiB per chunk and close on completion, failure or cancellation.
- Partial failed uploads are removed. Completed objects remain if DB binding
  fails or the request is a duplicate; these inaccessible orphans deliberately
  are not deleted after a possibly ambiguous commit. No automatic orphan cleanup
  is introduced. Cleanup must first reconcile DB references and in-flight uploads;
  never delete a committed original or run naive age-only deletion.
- Storage failures become sanitized DEPENDENCY_UNAVAILABLE (503); policy failures
  use VALIDATION (422), conflicts 409, scoped misses 404. Mid-response I/O failures
  terminate the stream rather than returning false success or JSON inside bytes.
  No file contents, storage errors, credentials or tokens are logged by this layer.

## Deployment

Development (`pnpm dev`) defaults to ignored repo-root `.cce-attachments`.
Production requires absolute `CCE_ATTACHMENT_STORAGE_DIRECTORY` on persistent
private storage, outside public/web roots. Grant access only to the service account;
do not allow other users/processes to replace files, links or directory entries.
The adapter assumes this service-owned trust boundary (not a shared writable folder).
All application instances must see the same objects; ephemeral per-instance disk
is unsuitable. Back up the object directory together with PostgreSQL references.
There are no new migrations or external production dependencies.

## Verification

Focused tests: `pnpm exec vitest run tests/unit/application/attachment-service.test.ts
packages/storage/src/local-attachment-storage.test.ts apps/web/server/attachment-routes.test.ts`.
They cover RBAC/authentication/CSRF, ownership, MIME, filenames, size, hash/retry,
binary roundtrip, storage failure translation, cancellation and HTTP range headers.
`tests/integration/database.test.ts` adds a PostgreSQL + local-storage upload,
idempotency and range roundtrip using the existing empty-database migration setup.
Run `pnpm typecheck` and `pnpm lint` with these tests.
