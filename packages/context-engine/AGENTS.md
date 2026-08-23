# Context Engine rules

- Merge deterministically whenever schema, exact, rule-based, or normalized comparison can decide.
- A model may return a classification proposal; it never mutates context or persistence.
- Preserve provenance in every result and never hard-delete semantic history.
- Changes are added, versioned, superseded, or deprecated. Conflict resolutions are explicit and auditable.
- Maintain identity, idempotency, deterministic stability, and no-silent-high-risk-overwrite property tests.

