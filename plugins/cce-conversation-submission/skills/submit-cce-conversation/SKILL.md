---
name: submit-cce-conversation
description: "Submit ChatGPT or Codex conversation messages to a Collaborative Context Engine project as evidence. Use only when the user explicitly asks to submit, import, save, or send the current conversation to CCE."
---

# Submit a conversation to CCE

Use this workflow only after an explicit request to send conversation content to CCE. Do not invoke CCE tools merely because a conversation contains decisions, requirements, or other useful context.

## Privacy and capture boundary

- Treat only messages supplied to the current invocation and visible in the current model context as available. Never claim access to provider history, hidden messages, deleted branches, account exports, local Codex transcript files, or other conversations.
- Include only content covered by the user's request. If the requested range is ambiguous, state what you can currently see and ask the user to narrow or approve that range before previewing.
- Set `captureScope` to `full` only when the full user-authorized range is actually available. Otherwise use `partial` and explain that limitation.
- Preserve message order, roles, available timestamps, and genuine provider IDs. Omit unavailable IDs and timestamps; never synthesize them.
- Represent non-text content only with supported reference blocks when a real reference and metadata are available. Never send credentials, hidden prompts, tool authorization headers, or unrelated workspace data.

## Resolve the destination

1. Call `list_projects`. If the user named a project, pass that exact name as the filter.
2. Do not guess a project ID. If no project matches, say so. If multiple projects remain, ask the user which one they mean.
3. Do not select an archived project. The CCE server independently enforces project scope and the authenticated user's role.

## Preview, disclose, and confirm

1. Call `preview_conversation_import` with the resolved `projectId` and the authorized messages. Use `chatgpt` as `source` on ChatGPT and `codex` on Codex. If the surface is genuinely unknown, ask the user instead of guessing.
2. Explain that previewing stores a confidential, expiring validation record but creates no CCE Conversation, Message, or Context change.
3. Show the user the exact project name and ID, conversation title, message count, unsupported-content count, every warning, expiration time, and duplicate status. If it is a duplicate, also show the existing import and conversation IDs.
4. Ask for explicit confirmation to submit that preview. An earlier general request is not the final confirmation because the preview details were not yet known.
5. Do not call `submit_conversation_import` unless the user confirms after seeing those details.

## Submit and report

Call `submit_conversation_import` with the exact `projectId` and `previewId`. On success, report the import ID, conversation ID, persisted message count, warnings, and whether CCE returned an existing duplicate. State plainly:

> The conversation is stored as evidence. Project Context was not updated.

Do not claim that decisions, requirements, or facts became canonical context. If the user wants that, offer to help start the repository's separate extraction and human-review workflow; do not imply this plugin already performed it.

On an authorization, validation, expiry, size, or network error, report the actual error and stop. Never retry a write with a different project, smaller capture, or altered identity unless the user explicitly approves the change.
