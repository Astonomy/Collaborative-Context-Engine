---
name: submit-cce-conversation
description: "Summarize and submit user-authorized ChatGPT or Codex conversation messages and supplied materials to a Collaborative Context Engine project as evidence. Use only when the user explicitly asks to submit, import, save, or send the current conversation to CCE."
---

# Submit a conversation to CCE

Use this workflow only after an explicit request to send conversation content to CCE. Do not invoke CCE tools merely because a conversation contains decisions, requirements, or other useful context.

## Privacy and capture boundary

- Treat only messages supplied to the current invocation and visible in the current model context as available. Never claim access to provider history, hidden messages, deleted branches, account exports, local Codex transcript files, or other conversations.
- Include only content covered by the user's request. When the user invokes this Skill or asks to submit "this conversation" without naming a narrower range, treat the currently visible user and assistant messages as the authorized range and preview them immediately. Do not ask for a separate range confirmation before previewing.
- Ask a scope clarification only when the user explicitly requests a narrower subset whose boundary cannot be determined reliably. A project-selection or scope clarification is not approval to perform the write.
- Set `captureScope` to `full` only when the full user-authorized range is actually available. Otherwise use `partial` and explain that limitation.
- Preserve message order, roles, available timestamps, and genuine provider IDs. Omit unavailable IDs and timestamps; never synthesize them.
- Preserve the original text of captured messages. A summary supplements the evidence; it never replaces or rewrites source messages.
- Represent non-text content only with supported reference blocks when a real reference and metadata are available. Never send credentials, hidden prompts, tool authorization headers, or unrelated workspace data.

## Summarize conversation and supplied materials

Before previewing, add a concise `summary` that covers the authorized conversation together with every attached file or other supplied item whose contents are actually available. Capture the request, relevant decisions, implementation or result, and the contribution of each material. If an item cannot be read, say that its contents were unavailable instead of inferring them from its name.

For image, audio, video, document, and other multimodal material, assess whether the original is important evidence. Treat it as important when its exact form materially supports a requirement, decision, implementation detail, error, expected visual or audio result, or verification outcome.

- For important material, copy the supplied `file_reference` or `image_reference` block into the corresponding source message without changing its `reference` or metadata. Do not crop, transcode, rewrite, or replace the original reference with the summary.
- For material that is not important enough to retain as an original reference, include its relevant contribution in the summary. Include the original anyway when the user explicitly requests all supplied originals.
- Never fabricate a reference for inline content when the host did not supply a stable reference. Preserve any available text and disclose the missing original reference in the preview warning.

In the summary, record an invoked plugin Skill with its namespaced Codex form `$plugin-name:skill-name`, not a Markdown link, attachment URI, or local cache path. Record this Skill exactly as `$cce-conversation-submission:submit-cce-conversation`. This normalization applies only to the generated summary or material inventory; preserve the original conversation text unchanged.

## Resolve the destination

1. Call `list_projects`. If the user named a project, pass that exact name as the filter.
2. Do not guess a project ID. If no project matches, say so. If multiple projects remain, ask the user which one they mean.
3. If the user did not name a project and exactly one active visible project is returned, use it without asking another question.
4. Do not select an archived project. The CCE server independently enforces project scope and the authenticated user's role.

## Preview, disclose, and confirm

For repeated submissions in the same provider conversation and CCE project, continue the existing evidence conversation:

- Retain the last successful result's `projectId`, `importId`, `conversationId`, and the last original message included in that submitted preview. Advance this checkpoint only after a successful submit, never after a preview or failed write.
- On the next submission, pass that `importId` as `previousImportId` and include only the new authorized messages and material references after the checkpoint. Summarize this delta. Messages exchanged while confirming the earlier preview were not in that preview and are eligible for the next delta.
- A previous success already visible in this conversation can serve as the checkpoint, including imports made before delta support. Use the exact returned IDs; do not fabricate provider IDs or infer a target from its title, similar content, or another conversation. If the earlier submitted boundary is unavailable, ask only for the missing boundary rather than silently resending old messages or creating a new Conversation.
- If no new authorized messages or materials are available, report that there is nothing new to submit and return the existing conversation ID. Do not create an empty preview.
- The server must return `operation: append` and the expected `targetConversationId` for a continuation. A stale predecessor is a conflict; do not drop `previousImportId` and retry as a new conversation.

1. Call `preview_conversation_import` with the resolved `projectId`, generated `summary`, authorized messages, retained original material references, and `previousImportId` for a continuation. Use `chatgpt` as `source` on ChatGPT and `codex` on Codex. If the surface is genuinely unknown, ask the user instead of guessing.
2. Explain that previewing stores a confidential, expiring validation record but creates no CCE Conversation, Message, or Context change.
3. Show the user the exact project name and ID, conversation title, summary, message count, unsupported-content count, every warning, expiration time, and duplicate status. State whether this creates a conversation or appends a delta; for an append, show `targetConversationId` and label the count as new messages. If it is a duplicate, also show the existing import and conversation IDs.
4. Ask once for explicit confirmation to submit that preview. The invocation or initial submission request authorizes creating the preview but is not the write confirmation because the preview details were not yet known.
5. When the user confirms the displayed preview, immediately call `submit_conversation_import` with that preview. Do not ask for another conversational confirmation, regenerate an unchanged preview, or repeat the preview disclosure before submitting. Do not bypass any confirmation enforced directly by the host platform.

## Submit and report

If a valid preview is already displayed in the conversation and the user replies affirmatively, treat that reply as the single required confirmation and submit it immediately. Call `submit_conversation_import` with the exact `projectId` and `previewId`. On success, report the import ID, conversation ID, persisted message count, warnings, and whether CCE returned an existing duplicate. For a delta, report the appended message count and retain the new import ID as the checkpoint for the next submission. A duplicate returns the existing result without appending its messages again. State plainly:

> The conversation is stored as evidence. Project Context was not updated.

Do not claim that decisions, requirements, or facts became canonical context. If the user wants that, offer to help start the repository's separate extraction and human-review workflow; do not imply this plugin already performed it.

On an authorization, validation, expiry, size, or network error, report the actual error and stop. Never retry a write with a different project, smaller capture, or altered identity unless the user explicitly approves the change.
