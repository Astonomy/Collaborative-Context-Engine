# S6 browser migration matrix

Inventory: `apps/web/app/page.tsx`, `components/cce-workbench.tsx` and its six panels. Next has one browser product route (`/`); API/MCP routes are not pages. Next remains available until S8.

| Next component / flow at `/`                   | Vue destination                      | API dependencies                                 | State dependencies                         | Status        |
| ---------------------------------------------- | ------------------------------------ | ------------------------------------------------ | ------------------------------------------ | ------------- |
| LoginPanel / sign out                          | LoginView / App                      | session GET/POST/DELETE                          | cookie, user, cancellation                 | migrated (S5) |
| ProjectSidebar list/create/rename/archive      | ProjectsView / ProjectView           | projects GET/POST, project GET/PATCH             | role, archive, HEAD                        | migrated      |
| ConversationPanel select/create/rename/archive | ConversationsView / ConversationView | conversations GET/POST, conversation GET/PATCH   | role, conversation status                  | migrated      |
| Evidence / streaming chat                      | ConversationView / MessageList       | messages GET, chat POST SSE                      | persisted sequence, IDs, delivery state    | migrated      |
| Extraction / proposal / review                 | ConversationView → MergeView         | deltas POST, merge-requests POST                 | server Delta, evidence stream              | migrated      |
| Agent run / approval / reject                  | ConversationView                     | agents/runs POST, run/resume POST                | status, proposal, owner, rationale         | migrated      |
| Merge comparison / resolution / commit         | MergeView / ConflictReview           | merge list/detail, resolution PUT, finalize POST | evaluated/expected HEAD, idempotency, role | migrated      |
| Current projection                             | ContextView                          | context GET                                      | committed items, provenance                | migrated      |
| Immutable history                              | HistoryView                          | context/commits GET                              | versions, IDs, timestamps                  | migrated      |

No existing browser import, member management, run-list/cancel/reconcile or multimedia preview pages were found. API availability does not imply UI scope. Extraction uses the existing `/deltas` endpoint. Attachments are an S7 extension point.

## Boundaries

Only presentation and request orchestration move. Backend authorization and merge semantics remain unchanged. Secondary routes load lazily. Messages use stable IDs and bounded pages of 100 ordered by persisted sequence, without per-message requests or deep watchers. The existing endpoint still returns the full evidence list; server pagination is outside this scope.

## Route and state map

All paths are relative to the configured Vue base (default /vue/): /projects,
/projects/:projectId, /projects/:projectId/conversations,
/projects/:projectId/conversations/:conversationId, /projects/:projectId/context,
/projects/:projectId/history and /projects/:projectId/merges/:mergeId?. Project access
is provided by the parent route as a shallow snapshot; child components own server
resources and form state. Message and merge identities key route lifetimes, aborting
old requests. No project evidence is stored in browser storage.

Finalization sends the displayed expected HEAD and retains its idempotency key for
manual retries of the same merge/head. 409 is shown with an explicit reload action;
there is no automatic mutation replay. A stale merge requires fresh server evaluation
through the existing extraction/review workflow. A successful commit refreshes project
access and merge state; context/history are read on their next route visit. High-risk
accept/alternative controls require Owner, while Viewer and archived resources remain
read-only. The backend remains the authority for every operation.

MessageList exposes a typed message-scoped attachments slot for S7; it neither fetches
attachments per message nor performs multimedia rendering. Pages hold at most 100
message nodes, use stable persisted IDs and v-memo, and preserve ascending sequence.
The complete array remains in a shallow ref because the API is not paginated. This
bounded-page approach avoids needing a variable-height virtualization dependency.

## Verification

Component tests cover role gates, archived resources, stale HEAD, 409 without replay,
agent approval/rejection, and 10,001-message ordering with a maximum of 100 rendered
nodes. The browser migration test uses contract-shaped API fixtures for deterministic
chat/extraction/review/commit and projection/history navigation. The session browser
test uses the real PostgreSQL API for cookie login, project/conversation lifecycle,
reload, cross-origin rejection and logout. These are separate kinds of evidence;
fixture flows do not claim to test model or database semantics.

### Recorded S6 results (2026-09-30)

- Root typecheck, lint, unit tests (479 root + 67 Vue), coverage and production build pass.
- Vue core coverage: 100% lines, 96.75% statements, 89.47% branches, 93.87% functions.
  This configured scope measures transport, session, action and router code, not SFC coverage.
- Chromium dev and production-preview runs: 3/3 pass in each, including real PostgreSQL
  lifecycle and the deterministic proposal-to-commit journey.
- An isolated PostgreSQL 16.15 database was migrated from empty and seeded for the real
  browser checks. No application database or backend contract was modified.
- Final Vue initial JavaScript: 62,030 gzip-9 bytes; route and chat chunks load separately.
- Changed frontend files pass formatting and git diff whitespace checks. The root format
  command reports 60 pre-existing files outside S6; they were left untouched.
- Root test:integration is blocked before execution: tsx is unavailable from the root,
  and the referenced scripts/run-postgres-tests.mts is absent. The full integration
  suite is not claimed as passing. S6 adds no database migration or backend behavior.

### Inline multimedia previews

Vue conversation messages display validated images, native video (without autoplay), and isolated 3D previews when visible. Messages with six or more attachments use an animated collection that expands on hover or keyboard focus and collapses when both leave. Reduced-motion preferences disable the transition. Clicking a preview opens the authenticated project-scoped attachment viewer in a new tab; the original download remains available. Unsupported media and inspection/load failures retain metadata and download fallback. No API, authorization, persistence, or deployment contract changes are required.
