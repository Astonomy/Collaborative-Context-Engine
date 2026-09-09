# Conversation import

CCE imports external chats as evidence. Import does not alter canonical Project Context. Normal extraction, merge review, and ContextCommit approval remain required.

## Supported input

Phase 1 supports ChatGPT JSON arrays, `{ "conversations": [...] }`, and ZIP files containing `conversations.json` or `conversations-N.json`. The adapter observes `id`, `title`, timestamps, `mapping`, `current_node`, message author role, parent links, and structured content. These fields do not escape the adapter.

ZIP/JSON uploads are limited to 8 MiB compressed, 32 MiB expanded, 100 archive entries, 2,000 conversations, 20,000 messages per conversation, and 1 MiB of text per message. ZIP traversal, absolute paths, encryption, data descriptors, unsupported compression, malformed UTF-8/JSON, excessive expansion, and corrupt sizes are rejected. Files are never extracted to disk and conversation contents are not logged.

The preview reports title, date, current-path message count, branch count, warnings, and duplicate status. Confirmation accepts a selection and atomically stores the resulting CCE Conversations, Messages, import manifest, and audit event. The full graph and external IDs remain in the manifest. Unsupported roles and content are warned and are not silently converted to user text.

Attachments are references only because CCE has no artifact store. ZIPs using data descriptors are currently unsupported.

The CCE conversation-submission plugin is a separate quick-capture path. It normalizes explicitly authorized, invocation-supplied ChatGPT or Codex messages into the same IR, persists a project- and actor-scoped 15-minute preview, and submits through the same application transaction. Exact normalized content, source, policy, and project provide deterministic idempotency. Partial capture and unsupported non-text blocks are disclosed before confirmation.

| Path                    | Intended use                                                                      |
| ----------------------- | --------------------------------------------------------------------------------- |
| ChatGPT official export | Bulk/high-fidelity history import from supported JSON/ZIP data                    |
| CCE Plugin/App          | Explicit current-conversation capture from messages supplied to an MCP invocation |
| Browser extension       | Future fallback; not implemented                                                  |
| Codex adapter           | Supplied active-task content only; no invented export or transcript schema        |

Claude, Gemini, generic JSON, HTML, and browser page capture need future concrete adapters. No provider cookies, credentials, DOM scraping, private history API, local Codex transcript parser, or undocumented provider capability is used. See [CCE plugin](plugins/cce-plugin.md) and [ADR 0008](adr/0008-provider-plugin-submissions.md).
