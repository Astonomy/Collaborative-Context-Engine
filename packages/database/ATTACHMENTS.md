# Attachment persistence (S1)

Attachment is immutable evidence bound to one project/conversation/message. The
binding is stored on the Attachment row; no second media-specific table or mutable
link exists. Existing Message contracts and text history are unchanged. Attaching
to an earlier message requires a new Message explaining the additional evidence.

`PostgresUnitOfWork.runWithAttachments` supplies the existing repositories plus an
`AttachmentRepository`. Insert attachments **before** the new Message in the same
transaction, and append an initial lifecycle event and the existing audit event.
Migration 0005 uses a deferred composite Message FK and an insertion guard: an
attachment cannot reference an already existing Message or survive without its new
Message. UPDATE and DELETE are rejected for attachments and lifecycle events.
An insertion/constraint failure rolls back the entire transaction.

The only application addition is the independent repository port and its export.
The existing UnitOfWork port and use cases remain unchanged; future authorized
attachment use cases can adopt the transaction capability without changing all
existing repository implementations. No HTTP endpoints or upload completion
contracts are enabled by this change.

## Authorization and trust

All lookups require projectId; the composite FK also checks conversationId and
messageId. These are internal persistence APIs, like the existing repositories:
callers must first use existing project RBAC, check active project/conversation
state, and derive actor/scope from the authenticated request. Repository lookup
alone is not membership authorization. There is no storage access or URL signing.

`attachmentResponseSchema` / `toAttachmentResponse` expose evidence metadata but
exclude the storage locator. Names and MIME values remain untrusted metadata;
neither file extensions nor mediaKind grant execution or inline rendering rights.
The future upload service must inspect bytes and compute size, SHA-256 and detected
MIME before persisting these server-owned values. Model assets are inert binary
evidence, never code or ModelProvider configuration.

Storage provider/key/version is globally unique and must identify an immutable
object; key syntax excludes URLs and query tokens. Signed URLs are not persisted.
Equal checksums are intentionally allowed, including across projects: a hash is
not identity, authorization, or a public deduplication oracle. Storage conflicts
must be normalized by the future application boundary.

## Metadata and lifecycle

Evidence JSON has a strict, bounded domain schema (dimensions, duration, format),
validated on both write and read. No arbitrary nested JSON is accepted. SQL adds
size/hash/kind checks alongside relational constraints. Corrupt persisted JSON
produces CORRUPT_DATA. Source identity, hash, actor and creation time never change.

Processing/availability are separate append-only events with actor, reason, time
and per-attachment sequence. Readers use the greatest sequence; absent events
must be treated as pending/quarantined, never ready. Callers serialize event
appends and retry sequence conflicts. Events are full status snapshots, allowing
processing retries without changing evidence. Deprecation/quarantine/unavailability
preserve history; physical object deletion is not implemented. Attachment evidence
does not advance context HEAD or create a semantic ContextCommit.

Preview metadata was considered but is deferred until immutable derivative
identity, checksum and processor provenance can be persisted together. No mutable
preview URL or unverified preview is embedded in the original evidence.

## Deployment and validation

Run the standard migration runner: 0005 is additive, changes no existing rows, and
uses the existing append-only trigger function. Backup the object versions along
with database references; PostgreSQL cannot enforce object-store immutability.

Domain/contract tests cover validation and storage redaction. The PostgreSQL
integration suite covers empty migration/replay, binding round trips, scoped reads,
cross-conversation/project failures, missing-message rollback, storage uniqueness,
equal hashes, late binding and immutable rows/events. Run `pnpm typecheck`,
`pnpm lint`, focused Vitest tests and `pnpm test:integration`.
