# CCE conversation-submission plugin

The repository plugin at `plugins/cce-conversation-submission` submits only the ChatGPT or Codex messages that the current invocation legitimately provides and the user explicitly authorizes. It is a quick, confirmation-first evidence path, not account-history access and not a replacement for ChatGPT Data Export.

## Platform capability record

This integration was checked against official OpenAI documentation on 2026-09-15:

- [Plugin architecture](https://developers.openai.com/plugins/concepts/plugins) packages Skills and MCP tools for ChatGPT and Codex, while warning that product surfaces can expose different capabilities.
- [MCP support](https://developers.openai.com/codex/extend/mcp) documents remote MCP-backed tools in ChatGPT web and Streamable HTTP MCP in local Codex clients. For local HTTP connections it documents `http_headers_helper`, whose command returns a JSON header map and is refreshed once after a 401 or 403 when its value changes.
- [Tool design](https://developers.openai.com/plugins/plan/tools) requires separate read/write tools and accurate action annotations. An annotation is a client safety signal, not an authorization boundary.
- [Plugin authentication](https://developers.openai.com/plugins/build/auth) expects OAuth 2.1 for an authenticated hosted MCP integration. CCE never accepts an OpenAI account token as a CCE credential.
- [Skills](https://developers.openai.com/plugins/build/skills) are the supported place for the preview, disclosure, confirmation, and submit workflow.
- [MCP UI](https://developers.openai.com/plugins/build/mcp-server) is optional. This flow needs structured results but no custom iframe, so the plugin does not declare an App UI.
- [ChatGPT data export](https://help.openai.com/en/articles/7260999-how-do-i-export-my-chatgpt-history-and-data) delivers an archive containing chat history for eligible accounts. CCE accepts the extracted conversation JSON for its bulk path; it does not accept the ZIP itself.

No cited capability grants a third-party plugin privileged access to a user's raw ChatGPT database or a stable Codex conversation export. Accordingly, there is no history API, DOM scraping, provider cookie access, local Codex transcript parsing, or invented export schema in this implementation. A surface can submit only the message array it actually places in the tool invocation. The Skill marks a capture `partial` unless the full authorized range is genuinely available.

## Supported paths and fidelity

| Path                    | Purpose                                        | Fidelity and status                                                                      |
| ----------------------- | ---------------------------------------------- | ---------------------------------------------------------------------------------------- |
| ChatGPT official export | Bulk/high-fidelity history import              | JSON importer; retains the source graph manifest and imports the selected current path   |
| CCE Plugin/App          | User-triggered current-conversation submission | Implemented through MCP; only invocation-supplied messages and references are available  |
| Browser extension       | Future exact-page fallback                     | Not implemented; no DOM or session scraping is present                                   |
| Codex adapter           | Supported invocation content only              | Implemented for supplied messages; no Codex export or local transcript format is assumed |

The Skill prepares a concise evidence summary covering the authorized conversation and the contents of supplied files it can actually inspect. The summary is stored separately from the original messages and is displayed in the preview; it never replaces or rewrites the source text. Invoked plugin Skills are named in that summary with their namespaced Codex form, for example `$cce-conversation-submission:submit-cce-conversation`, without leaking a local cache path.

Text becomes CCE `Message` evidence. The Skill assesses whether supplied multimodal material is important to requirements, decisions, implementation, errors, expected results, or verification. Important `file_reference` and `image_reference` blocks are copied without changing their reference or metadata and remain in the append-only import manifest. Local binaries use the staged attachment upload described below. A provider reference alone is retained as a reference and does not claim that CCE received the original bytes. Provider conversation/message IDs and timestamps are persisted only when the caller supplies genuine values. CCE records the authenticated importing user separately.

## Tool workflow

The MCP endpoint is `GET|POST|DELETE /mcp` and exposes:

1. `list_projects` returns only projects visible to the authenticated CCE user. Exact case-insensitive name filtering can still return multiple candidates; the Skill must not guess.
2. `preview_conversation_import` validates and normalizes a capture, reports its destination, evidence summary, counts, warnings, expiry, and exact-content duplicate status, then stores a confidential 15-minute preview. It creates no Conversation, Message, ContextDelta, ContextItem, or ContextCommit.
3. `submit_conversation_import` consumes the preview without resending the conversation. It atomically creates the import manifest, supported Messages, and an AuditEvent. An initial submission creates one Conversation; a delta appends to the existing Conversation. Repeating the same normalized capture in the same project returns the existing import.

The preview annotation is `readOnlyHint: false` because it persists an expiring record, even though it is non-destructive and read-only with respect to imported evidence and canonical context. The submit annotation is `readOnlyHint: false`, `destructiveHint: false`, and `idempotentHint: true`: it creates append-only evidence but does not overwrite or delete existing state. CCE RBAC remains authoritative, and the Skill still requires post-preview confirmation. Owners and Editors have `conversation:import`; Viewers do not.

The MCP result returns IDs rather than a fabricated deep link because the current single-page Web UI has no stable route for an individual Conversation.

### Repeated submissions in one conversation

After a successful submit, the Skill retains the returned project/import/conversation IDs and the last source message included in that preview. The next submission to the same project sends only messages after that boundary, with `previousImportId` set to the last successful import ID. Its summary covers the delta. A preview alone does not advance the boundary; confirmation messages after the previous preview are part of the next delta. With no new material, the Skill reports no changes without creating a preview.

The preview reports `operation: append`, `targetConversationId`, the existing conversation title, and the delta message count. The server resolves the target from the persisted import, checks the project, importing user, provider, and active conversation, and appends under transaction locks with continuous message sequences. Each delta gets an immutable import manifest pointing to its predecessor and an audit event. Original messages, import records, the conversation's Branch, and Context HEAD are preserved. An unchanged retry returns the existing import; a different delta based on an already-continued import fails with a conflict. The client must not retry that conflict by omitting the predecessor.

Existing successful provider imports are valid predecessors even when no provider conversation ID was available. The Skill uses the result already visible in that same conversation; titles and similar content are not identity. If the submitted boundary is unavailable after context compaction, it needs the missing boundary instead of guessing. There is no automatic retroactive merging of previously separate Conversations.

Deploy the updated server together with the updated Skill. Binary submission additionally requires migration `0006_import_attachment_uploads.sql`. Reinstall the plugin from its local marketplace after updating the Skill.

## Local Codex setup

The checked-in plugin [.mcp.json](../../plugins/cce-conversation-submission/.mcp.json) targets `http://localhost:3001/mcp`. The transport adapter lives in `apps/api/handlers/mcp/route.ts` and the Node HTTP router mounts it directly. `packages/mcp-server` and application use cases have no Next dependency. The legacy Next route delegates to the same adapter for compatibility.

1. Install with `pnpm install --frozen-lockfile`, migrate PostgreSQL with `pnpm db:migrate`, and provision a CCE user token through the existing identity flow.
2. Start only the API with `pnpm dev:api`. `CCE_API_PORT` defaults to `3001`; Next.js is not required. The API still requires its database, session secret and model runtime configuration; submitting evidence makes no model call.
3. Supply the CCE-issued token as `CCE_MCP_ACCESS_TOKEN` in the Codex **process environment**, using your local secret tooling. Restart Codex after changing its environment. Never paste the token into prompts, Skills, the repository, or plugin JSON. The header helper reads only this environment variable, not a private credential file.
4. Install/reinstall the repository plugin and verify `list_projects`, `preview_conversation_import`, and `submit_conversation_import` are available.
5. If you change the API port, change the local MCP URL to `http://localhost:<CCE_API_PORT>/mcp` and set `CCE_API_URL` to the same origin for the attachment helper. Both transports must target this standalone API.

The server authenticates each bearer token through the existing hashed CCE token store and resolves its user before application/database RBAC. The API does not treat a shared environment token as authorization or grant a default project/actor. Invalid tokens and unauthorized projects fail closed.

### Local binary attachments

Use `scripts/cce-upload-attachments.mjs` with an explicitly authorized capture JSON file. Its only input files are paths explicitly listed on the capture's messages; it never discovers transcripts or workspace files. Each message can supply `localAttachments` entries with `path`, `mimeType`, and a stable UUID `uploadId`. That UUID is an upload retry key, never a fabricated provider message ID.

The helper reads actual file bytes and posts them to `POST /api/projects/{projectId}/imports/attachments` on `CCE_API_URL` (default `http://localhost:3001`). It receives a server-issued `attachmentId`, removes local paths, and returns the original submission with message `attachmentIds`. Then pass this returned capture to MCP preview, display the server's attachment inventory (filename, size, checksum, ID), request confirmation, and submit the exact preview. An attachment requires a supported source message with original non-empty text; do not synthesize a filename caption to meet that requirement.

Uploads are private, project/user scoped staging records, expire for binding after 24 hours, and create no Conversation or Message. Confirmation atomically binds their immutable storage identities to new original Messages, persists the provenance manifest and attachment lifecycle event, and leaves Project Context unchanged. One attachment binds once; identical upload retries return the same ID, changed bytes or metadata conflict, and identical submission retries return the existing import. Upload failure stops the submission. No filename-only text substitution is allowed.

Staging records are append-only. Failed/ambiguous transactions or retries may leave inaccessible storage objects; no object deletion is attempted where a commit may have succeeded. Deployment storage retention/reconciliation applies to these objects too; expiry is an authorization limit, not deletion of evidence. Migration `0006_import_attachment_uploads.sql` is required.

## Hosted ChatGPT deployment gate

The repository does not contain a public deployment URL, OAuth issuer, or registered production client, so the checked-in localhost connector is not represented as hosted-ChatGPT-ready. Before connecting it in ChatGPT:

1. deploy the same `/mcp` handler behind public HTTPS;
2. place an OAuth 2.1 authorization layer in front of CCE that issues CCE-scoped tokens and publishes the required protected-resource/authorization-server metadata;
3. map the OAuth subject to a CCE user without ever accepting the user's OpenAI token as a CCE credential;
4. update the packaged MCP URL to the real HTTPS endpoint and complete the OpenAI plugin connection/review flow;
5. rerun authorization, privacy, and cross-project tests against that deployment.

Long-lived CCE API tokens are suitable for the documented local Codex process-environment flow, not for a hosted ChatGPT plugin. This is an explicit deployment limitation, not a hidden fallback to unauthenticated access.

## Manual smoke procedure

This procedure is documentation; it is not evidence that a real OpenAI-account smoke test was run.

1. Connect the supported client to the configured CCE MCP endpoint and authenticate as an Editor or Owner.
2. Start a conversation with several user and assistant messages.
3. Ask `@CCE submit this conversation to <exact project name>`.
4. Verify the plugin lists/resolves the project, then shows the project ID, title, evidence summary, message count, unsupported count, warnings, duplicate status, and preview expiry. With an important supplied image or file, verify the preview warns that the original reference will remain unchanged in the import manifest.
5. Verify no CCE Conversation exists before approval.
6. Approve the shown preview explicitly.
7. Verify the result contains an import ID and conversation ID, and open that Conversation from the CCE project's conversation list.
8. Add more messages and submit again in the same provider conversation. Verify the preview says append and shows the prior Conversation ID and only the new message count. Approve once; verify that the Conversation ID stays the same, its messages are appended in sequence, and the import ID changes. Retrying that exact delta returns the existing import without adding messages. Context HEAD stays unchanged.
9. Repeat with a Viewer and with a different project ID; both writes must fail without partial evidence.

For hosted ChatGPT, perform this only after the OAuth deployment gate above is complete. For Codex, describe the capture as partial whenever the active surface did not supply the entire requested range.
