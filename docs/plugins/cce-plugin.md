# CCE conversation-submission plugin

The repository plugin at `plugins/cce-conversation-submission` submits only the ChatGPT or Codex messages that the current invocation legitimately provides and the user explicitly authorizes. It is a quick, confirmation-first evidence path, not account-history access and not a replacement for ChatGPT Data Export.

## Platform capability record

This integration was checked against official OpenAI documentation on 2026-09-09:

- [Plugin architecture](https://developers.openai.com/plugins/concepts/plugins) packages Skills and MCP tools for ChatGPT and Codex, while warning that product surfaces can expose different capabilities.
- [MCP support](https://developers.openai.com/codex/extend/mcp) documents remote MCP-backed tools in ChatGPT web and Streamable HTTP MCP in local Codex clients. It documents bearer-token and OAuth support for Codex-hosted MCP connections.
- [Tool design](https://developers.openai.com/plugins/plan/tools) requires separate read/write tools and accurate action annotations. An annotation is a client safety signal, not an authorization boundary.
- [Plugin authentication](https://developers.openai.com/plugins/build/auth) expects OAuth 2.1 for an authenticated hosted MCP integration. CCE never accepts an OpenAI account token as a CCE credential.
- [Skills](https://developers.openai.com/plugins/build/skills) are the supported place for the preview, disclosure, confirmation, and submit workflow.
- [MCP UI](https://developers.openai.com/plugins/build/mcp-server) is optional. This flow needs structured results but no custom iframe, so the plugin does not declare an App UI.
- [ChatGPT data export](https://help.openai.com/en/articles/7260999-how-do-i-export-my-chatgpt-history-and-data) delivers a ZIP containing chat history for eligible accounts. That documented account export remains CCE's bulk path.

No cited capability grants a third-party plugin privileged access to a user's raw ChatGPT database or a stable Codex conversation export. Accordingly, there is no history API, DOM scraping, provider cookie access, local Codex transcript parsing, or invented export schema in this implementation. A surface can submit only the message array it actually places in the tool invocation. The Skill marks a capture `partial` unless the full authorized range is genuinely available.

## Supported paths and fidelity

| Path                    | Purpose                                        | Fidelity and status                                                                                 |
| ----------------------- | ---------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| ChatGPT official export | Bulk/high-fidelity history import              | Existing JSON/ZIP importer; retains the source graph manifest and imports the selected current path |
| CCE Plugin/App          | User-triggered current-conversation submission | Implemented through MCP; only invocation-supplied messages and references are available             |
| Browser extension       | Future exact-page fallback                     | Not implemented; no DOM or session scraping is present                                              |
| Codex adapter           | Supported invocation content only              | Implemented for supplied messages; no Codex export or local transcript format is assumed            |

Text becomes CCE `Message` evidence. Supported reference/tool blocks remain in the append-only import manifest and produce warnings because CCE has no artifact store. Provider conversation/message IDs and timestamps are persisted only when the caller supplies genuine values. CCE records the authenticated importing user separately.

## Tool workflow

The MCP endpoint is `GET|POST|DELETE /mcp` and exposes:

1. `list_projects` returns only projects visible to the authenticated CCE user. Exact case-insensitive name filtering can still return multiple candidates; the Skill must not guess.
2. `preview_conversation_import` validates and normalizes a capture, reports its destination, counts, warnings, expiry, and exact-content duplicate status, then stores a confidential 15-minute preview. It creates no Conversation, Message, ContextDelta, ContextItem, or ContextCommit.
3. `submit_conversation_import` consumes the preview without resending the conversation. It is annotated as a destructive write and atomically creates the import manifest, one Conversation, supported Messages, and an AuditEvent. Repeating the same normalized capture in the same project returns the existing import.

The preview annotation is `readOnlyHint: false` because it persists an expiring record, even though it is non-destructive and read-only with respect to imported evidence and canonical context. The submit annotation is `readOnlyHint: false`, `destructiveHint: false`, and `idempotentHint: true`: it creates append-only evidence but does not overwrite or delete existing state. CCE RBAC remains authoritative, and the Skill still requires post-preview confirmation. Owners and Editors have `conversation:import`; Viewers do not.

The MCP result returns IDs rather than a fabricated deep link because the current single-page Web UI has no stable route for an individual Conversation.

## Local Codex setup

The checked-in `.mcp.json` targets `http://localhost:3000/mcp` and asks Codex to read a CCE-issued bearer token from `CCE_MCP_ACCESS_TOKEN`. Keep that token in the environment of the process that launches Codex; do not paste it into a prompt, Skill, JSON file, or conversation.

1. Install dependencies, migrate and seed PostgreSQL, and start CCE with `pnpm dev`.
2. Set `CCE_MCP_ACCESS_TOKEN` to an API token issued for the intended CCE user. For local development it may equal the separately stored `CCE_SEED_API_TOKEN` value.
3. Add this repository as a local/plugin marketplace and install `cce-conversation-submission` using the plugin controls available in the current Codex client.
4. Restart the client after changing its environment, then inspect `/mcp` or the MCP server settings and verify the `cce` tools are present.

The environment variable contains only a CCE credential. The server hashes API tokens at rest and applies normal project-scoped RBAC on every tool operation.

## Hosted ChatGPT deployment gate

The repository does not contain a public deployment URL, OAuth issuer, or registered production client, so the checked-in localhost connector is not represented as hosted-ChatGPT-ready. Before connecting it in ChatGPT:

1. deploy the same `/mcp` handler behind public HTTPS;
2. place an OAuth 2.1 authorization layer in front of CCE that issues CCE-scoped tokens and publishes the required protected-resource/authorization-server metadata;
3. map the OAuth subject to a CCE user without ever accepting the user's OpenAI token as a CCE credential;
4. update the packaged MCP URL to the real HTTPS endpoint and complete the OpenAI plugin connection/review flow;
5. rerun authorization, privacy, and cross-project tests against that deployment.

Long-lived CCE API tokens are suitable for the documented local Codex environment-variable flow, not for a hosted ChatGPT plugin. This is an explicit deployment limitation, not a hidden fallback to unauthenticated access.

## Manual smoke procedure

This procedure is documentation; it is not evidence that a real OpenAI-account smoke test was run.

1. Connect the supported client to the configured CCE MCP endpoint and authenticate as an Editor or Owner.
2. Start a conversation with several user and assistant messages.
3. Ask `@CCE submit this conversation to <exact project name>`.
4. Verify the plugin lists/resolves the project, then shows the project ID, title, message count, unsupported count, warnings, duplicate status, and preview expiry.
5. Verify no CCE Conversation exists before approval.
6. Approve the shown preview explicitly.
7. Verify the result contains an import ID and conversation ID, and open that Conversation from the CCE project's conversation list.
8. Verify messages and the audit event exist, the project Context HEAD is unchanged, and repeating the same capture returns the existing Conversation.
9. Repeat with a Viewer and with a different project ID; both writes must fail without partial evidence.

For hosted ChatGPT, perform this only after the OAuth deployment gate above is complete. For Codex, describe the capture as partial whenever the active surface did not supply the entire requested range.
