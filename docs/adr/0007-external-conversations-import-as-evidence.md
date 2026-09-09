# ADR 0007: External conversations import as evidence

- Status: Accepted
- Date: 2026-09-08

## Decision

Provider adapters translate untrusted exports into a provider-neutral External Conversation IR. Application use cases preview and then atomically persist selected conversations as message evidence plus an append-only import manifest. They never create ContextItems, ContextDeltas, MergeRequests, or ContextCommits.

ChatGPT graph structure is retained in the manifest. Because CCE currently has one linear Branch per Conversation, Phase 1 imports the path ending at `current_node`; branch points produce warnings. This corresponds to option C: retain the source graph while choosing one canonical evidence path.

Import identity is `(project, SHA-256 source file, current_path policy)`. Repeating it returns the prior completed result. External actors remain metadata; the authenticated CCE user is `createdBy`, while imported messages use the explicit versioned import-policy actor.

## Consequences

New bulk providers implement the importer interface without changing Domain or Context Engine. Structured content is retained in bounded manifest metadata; only text becomes current CCE message content because no artifact subsystem exists. Explicit provider-plugin submissions are addressed separately by [ADR 0008](0008-provider-plugin-submissions.md); that path consumes only invocation-supplied content and does not invent a Codex export format.
