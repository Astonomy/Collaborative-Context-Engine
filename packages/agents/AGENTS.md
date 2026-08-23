# Agent workflow rules

- Agents consume routed context and can only propose `ContextDelta` values.
- Agents never write project context directly or bypass `ContextCommit`, RBAC, audit, or human approval.
- Workflows must persist explicit states and support pause-for-approval and deterministic resume.
- Keep the first workflow small: manager, extractor, research, review, and merge roles only.
