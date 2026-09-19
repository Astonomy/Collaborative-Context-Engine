# Conversation import

CCE imports external chats as evidence. Import does not alter canonical Project Context. Normal extraction, merge review, and ContextCommit approval remain required.

## Supported input

Phase 1 supports ChatGPT `.json` files containing either a conversation array or `{ "conversations": [...] }`. ZIP uploads are rejected. Historical ZIP import manifests created by older versions remain readable and append-only. The adapter observes `id`, `title`, timestamps, `mapping`, `current_node`, message author role, parent links, and structured content. These fields do not escape the adapter.

JSON uploads are limited to 8 MiB, 2,000 conversations, 20,000 messages per conversation, and 1 MiB of text per message. Non-JSON files, malformed UTF-8, malformed JSON, and excessive input are rejected. Conversation contents are not logged.

The preview reports title, date, current-path message count, branch count, warnings, and duplicate status. Confirmation accepts a selection and atomically stores the resulting CCE Conversations, Messages, import manifest, and audit event. The full graph and external IDs remain in the manifest. Unsupported roles and content are warned and are not silently converted to user text.

Attachments are references only because CCE has no artifact store. Provider submissions can carry a separate evidence summary; important file and image references remain unchanged in the append-only import manifest and are not converted into CCE Message text. ZIPs using data descriptors are currently unsupported.

The CCE conversation-submission plugin is a separate quick-capture path. It normalizes explicitly authorized, invocation-supplied ChatGPT or Codex messages, a generated evidence summary, and selected original material references into the same IR, persists a project- and actor-scoped 15-minute preview, and submits through the same application transaction. The summary covers accessible attached content but never replaces or rewrites the captured messages. Exact normalized content, source, policy, and project provide deterministic idempotency. Partial capture and non-text blocks are disclosed before confirmation.

For subsequent submissions in the same provider conversation, the Skill sends only the delta since its last successful preview boundary and the returned `importId` as `previousImportId`. The server appends those messages to the existing Conversation, retains its Branch, and records a new immutable import manifest linking the predecessor. Previews distinguish `create` from `append` and show the existing Conversation ID for an append. Exact retries are idempotent; a different delta using an already-continued predecessor conflicts. Missing or unauthorized predecessors never fall back to creating a conversation. The offline ChatGPT export path keeps its existing behavior.

| Path                    | Intended use                                                                      |
| ----------------------- | --------------------------------------------------------------------------------- |
| ChatGPT official export | Bulk/high-fidelity history import from supported JSON data                        |
| CCE Plugin/App          | Explicit current-conversation capture from messages supplied to an MCP invocation |
| Browser extension       | Future fallback; not implemented                                                  |
| Codex adapter           | Supplied active-task content only; no invented export or transcript schema        |

Claude, Gemini, generic JSON, HTML, and browser page capture need future concrete adapters. No provider cookies, credentials, DOM scraping, private history API, local Codex transcript parser, or undocumented provider capability is used. See [CCE plugin](plugins/cce-plugin.md) and [ADR 0008](adr/0008-provider-plugin-submissions.md).
