# Merge semantics

CCE merges a Branch Delta against Base and current canonical HEAD. The pipeline stops at the earliest deterministic answer:

1. Runtime schema and provenance validation.
2. Exact identity/key/scope/value comparison.
3. Explicit domain rules.
4. Canonical normalized comparison.
5. Semantic classification proposal for unresolved C2 cases.
6. Human review and transactional finalization.

## Results

- `duplicate`: proposed canonical value already exists; preserve the evidence in audit/delta history but create no duplicate item.
- `C0 no conflict`: different normalized key or demonstrably disjoint scope.
- `C1 compatible expansion`: only an explicitly allow-listed merge rule such as set union; arbitrary JSON deep merge is forbidden.
- `C2 potential conflict`: scope or semantic relation is uncertain. Model failure or low confidence remains a human conflict.
- `C3 direct conflict`: mutually exclusive authoritative values for the same key and scope.
- `C4 temporal supersession`: proposal explicitly names the replaced version and replacement intent/effective time.

The engine emits an immutable MergePlan; it does not write state. High-risk changes remain review-required even when there is no concurrent branch conflict.

## Three-way rules

- Current equals Base: no concurrent canonical change; proposal may proceed to risk review.
- Proposed equals Current: no-op duplicate.
- Proposed equals Base while Current changed: do not roll current state backward.
- All three differ: classify using C1–C4, otherwise C2.
- A stale Base that is a canonical ancestor is valid merge input. A missing, cross-project, or non-ancestor Base is invalid.
- Conflict resolution locks the project before reading review state, and re-reads all stored resolutions
  before transitioning the request to ready. An `edit` may change only the proposed value; kind, key,
  scope, supersession target, authority, confidence, and provenance remain server-controlled.
- Before committing, CCE applies the resolved batch to a copy of HEAD and rejects any resulting pair of
  active authoritative lineages in the same kind/key/scope slot. Deprecating an old authoritative
  lineage and adding its active replacement in the same atomic commit is valid.

## Core properties

Empty Delta is identity; replay is idempotent; deterministic inputs are stable; disjoint clean changes commute; provenance is never dropped; no decision/requirement/constraint is silently overwritten. A finalize operation records one immutable outcome even when all resolutions keep current and no semantic commit is created: retrying the same key returns `no_changes`, while a different key conflicts.
