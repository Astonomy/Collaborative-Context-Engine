# ADR 0004: Human approval for high-risk context

- Status: Accepted
- Date: 2026-08-23

## Decision

AI and agents only propose ContextDeltas. Adding, changing, superseding, or deprecating a decision, requirement, constraint, or architecture item requires an authorized human Owner in the MVP. Confidence is extraction metadata, never approval.

Low-risk automatic commit is disabled by default. A later project policy may explicitly allow narrow item kinds after an ADR and evaluation demonstrates an acceptably low false-auto-merge rate.

Temporal supersession requires an explicit target and replacement intent. A newer timestamp alone never authorizes C4 supersession.

“Keep alternatives” retains the current item as authoritative and creates the proposal as a visibly linked alternative; it never leaves two mutually exclusive authoritative values.
