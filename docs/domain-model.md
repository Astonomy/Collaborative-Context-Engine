# Domain model

## Evidence and collaboration

- `User` is a human identity. API tokens are hashed credentials, not domain identity.
- `Project` is the authorization and canonical-context boundary. It always has at least one Owner.
- `Conversation` preserves raw evidence and may be archived, never silently deleted.
- `Message` has a project-local conversation, monotonic sequence, role, terminal delivery state, and immutable completed content.
- `Branch` has one Conversation and an immutable base ContextCommit. It transitions from open to merged or abandoned.

## Semantic state

- `ContextDelta` is an immutable, schema-versioned proposal over a Branch base. Every change identifies evidence messages.
- `ContextCommit` is an immutable atomic semantic state transition. Except for genesis, it has one parent and one or more real changes.
- `ContextItemVersion` stores a normalized key, structured scope, typed JSON value, lifecycle, authority, confidence, lineage, and provenance.
- `ProjectContextEntry` is the rebuildable HEAD projection from logical item ID to current version.
- `MergeRequest`, `MergeConflict`, and `MergeResolution` record review without rewriting the original proposal.
- `MergeFinalization` is an immutable, one-per-request idempotency record. It preserves the hashed
  operation key and the terminal `committed` or `no_changes` outcome; committed outcomes also identify
  the resulting ContextCommit.
- `AuditEvent` is append-only and records management and semantic actions.

## Context item dimensions

Kinds are fact, decision, requirement, assumption, constraint, task, question, risk, artifact, preference, and rejected option. `authority` (`authoritative` or `alternative`) is independent from `lifecycle` (`active`, `deprecated`, or `superseded`). Kind-specific task/question state belongs in the value schema, not a universal status field.

Every committed item version has at least one provenance chain with matching project, conversation, and message IDs plus the proposing actor and committing human/policy.
