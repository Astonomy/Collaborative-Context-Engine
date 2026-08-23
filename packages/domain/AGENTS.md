# Domain rules

- Keep this package pure and deterministic; it may depend only on Zod and `@cce/shared`.
- Constructors and transition functions enforce invariants at runtime and expose narrow typed APIs.
- A context item without complete provenance is invalid.
- Accepted decisions, requirements, and constraints cannot be silently replaced.
- Tests do not access the database, network, clock, randomness, or model providers unless those values are injected.

