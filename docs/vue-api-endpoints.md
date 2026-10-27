# Vue API endpoint matrix

Current deployment (2026-10-08): default scripts build and run static Vue plus independent Node API.
Next is an explicit legacy option. See [deployment](deployment.md); earlier host dependency findings
below describe the migration baseline.

2026-10-08 workspace verification. `p`, `c`, `a`, `m`, `f`, `r` denote encoded IDs.
Every endpoint below resolves through `apps/vue/src/api/client.ts` using
`VITE_CCE_API_BASE_URL`; no component constructs an API origin. Empty base means a
same-origin static gateway or development proxy to the standalone API.

| Vue consumer                                          | Method              | API endpoint                                                    |
| ----------------------------------------------------- | ------------------- | --------------------------------------------------------------- |
| Session bootstrap / login / logout                    | GET / POST / DELETE | `/api/session`                                                  |
| Projects                                              | GET / POST          | `/api/projects`                                                 |
| Project access / rename / archive                     | GET / PATCH         | `/api/projects/{p}`                                             |
| Conversations                                         | GET / POST          | `/api/projects/{p}/conversations`                               |
| Conversation detail / rename / archive                | GET / PATCH         | `/api/projects/{p}/conversations/{c}`                           |
| Message evidence (includes structured attachments)    | GET                 | `/api/projects/{p}/conversations/{c}/messages`                  |
| Chat (POST SSE, validated events, no automatic retry) | POST                | `/api/projects/{p}/conversations/{c}/chat`                      |
| Extraction proposal                                   | POST                | `/api/projects/{p}/conversations/{c}/deltas`                    |
| Canonical context                                     | GET                 | `/api/projects/{p}/context`                                     |
| Context history                                       | GET                 | `/api/projects/{p}/context/commits`                             |
| Merge list / proposal review                          | GET / POST          | `/api/projects/{p}/merge-requests`                              |
| Merge detail                                          | GET                 | `/api/projects/{p}/merge-requests/{m}`                          |
| Conflict resolution                                   | PUT                 | `/api/projects/{p}/merge-requests/{m}/conflicts/{f}/resolution` |
| Commit reviewed changes                               | POST                | `/api/projects/{p}/merge-requests/{m}/finalize`                 |
| Agent execution                                       | POST                | `/api/projects/{p}/agents/runs`                                 |
| Agent decision                                        | POST                | `/api/projects/{p}/agents/runs/{r}/resume`                      |
| Raw attachment upload                                 | POST                | `/api/projects/{p}/conversations/{c}/attachments`               |
| Attachment detail                                     | GET                 | `/api/projects/{p}/attachments/{a}`                             |
| Attachment inspection                                 | GET                 | `/api/projects/{p}/attachments/{a}/inspection`                  |
| Image/model bytes, video Range requests, download     | GET                 | `/api/projects/{p}/attachments/{a}/content`                     |

JSON uses existing `@cce/api-contracts` runtime schemas. SSE validates each event.
Upload validates its DTO and project/conversation association. Binary previews retain
byte limits; video URLs use credentialed media requests. Browser DTOs exclude storage locators.
Message rendering reads `message.attachments[]`; text resembling `Attachment: filename`
has no effect on attachment rendering. The GET messages handler joins authorized metadata
by message ID. Old message/event payloads without attachments normalize to an empty array.

## Remaining legacy dependencies

- `apps/api` still has no package manifest, standalone listener or start command. Its
  handlers are currently exposed by `apps/web/app/api`. Changing Vue configuration
  does not provide a running standalone backend at port 3001.
- Root `dev`, `start`, `build`, Docker packaging and staging scripts still run/package
  Next and host Vue assets there. Independent Vue build and `dev:vue` work, but the
  repository default deployment is not yet independent of Next.
- Existing cookie authentication and session creation enforce same-origin requests.
  Separate browser/API origins require host CORS and explicitly authorized frontend
  origins. `credentials: include` alone does not change this server policy.
- Existing real-backend Playwright suites still boot the legacy host. Mock API tests
  verify the Vue boundary; they do not prove a standalone deployment works.
- Legacy React UI and MCP HTTP mounting remain in `apps/web`. They are not imported
  by the Vue browser source.

The frontend migration is ready for a standalone API/gateway, but end-to-end removal
of Next requires the listener, authentication policy and deployment changes above.

## Verification

- `pnpm lint`, `pnpm typecheck`, `pnpm build`: passed.
- `pnpm test:coverage`: 499 repository tests passed; the final Vue coverage run passed
  140 tests. Vue client is
  included in coverage. Vue statement coverage 96.49%, branch coverage 88.53%.
- `pnpm --filter @cce/vue test:media`: passed against Vite and mocked API without Next;
  covers upload, images, Range video, isolated model, inert files and grouped attachments.
- Source search for `fetch(`, axios, EventSource, Next host/configuration and server imports:
  no component transport or Next runtime dependency. Browser HTTP fetch lives in the API
  client; upload uses XHR for progress with the same centralized URL/credential policy.
- `pnpm format:check`: failed on 60 pre-existing files outside this change; edited
  frontend, handler, contract and documentation files are formatted.
- `pnpm test:integration` and `pnpm test:e2e`: failed before tests because PostgreSQL
  on localhost:5432 refused connections. Docker is unavailable in this environment.
  Empty-database migration and real-backend deployment acceptance remain unverified.
