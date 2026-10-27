# Collaborative Context Engine (CCE)

CCE is a provider-independent collaboration engine that turns conversation evidence into reviewed,
versioned project context. It gives teams a Git-like workflow for semantic facts, decisions,
requirements, constraints, tasks, and risks without treating a model chat as the source of truth.

CCE 是一个与模型供应商解耦的团队协作上下文引擎：它把对话当作证据，把经过审查的项目上下文写入
PostgreSQL，并用类似 Git 的 Delta、Merge Request 和不可变 Commit 工作流管理语义变更。

## 核心原则 / Core principles

- Conversation is evidence, not state. 对话保留原始证据，但不直接成为项目状态。
- PostgreSQL is the source of truth. 持久化上下文及线性 `ContextCommit` 历史是唯一权威状态。
- Every committed item keeps Project → Commit → Conversation → Message → actor provenance.
  每个上下文条目都可追溯到项目、提交、对话、消息与行为主体。
- Deterministic validation, comparison, and normalization run before model reasoning.
  先执行确定性验证、比较和归一化，再把无法判定的语义问题交给模型建议。
- Models and agents propose; authorized humans approve high-risk semantic changes.
  模型和 Agent 只提出变更，高风险语义由有权限的人类 Owner 提交。
- Core packages do not import provider SDKs, SQL adapters, or web frameworks.
  领域与合并引擎不依赖模型供应商、数据库实现或 Web 框架。

## 架构 / Architecture

```text
Browser -> Vue static assets (apps/vue/dist)
              -> /api and /mcp gateway -> standalone Node API (apps/api)
              -> Application -> Domain / Context Engine -> PostgreSQL / ModelProvider
Next.js (apps/web) is an optional legacy host.
```

This is a TypeScript modular monolith with independently deployed Vue static assets and a Node API. Qwen/vLLM runs as an optional,
separate OpenAI-compatible service; provider state can be discarded without losing CCE history.
Canonical context history is linear, while each conversation branch retains the immutable base commit
that its participant saw. See [Architecture](docs/architecture.md),
[Domain model](docs/domain-model.md), and [merge semantics](docs/merge-semantics.md).

CCE 采用单体部署、模块化边界：Web/API、应用用例、领域规则、确定性合并、PostgreSQL 适配器和模型
适配器分别测试，默认 Vue UI 与 Node API 独立运行和部署，Next 仅保留为历史兼容入口。Qwen/vLLM 独立运行，供应商侧会话丢失不会损坏
CCE 的证据、版本或权威上下文。

| Workspace                      | Responsibility                                                     |
| ------------------------------ | ------------------------------------------------------------------ |
| `apps/vue`                     | Default browser UI, validated API client, multimedia rendering     |
| `apps/web`                     | Optional legacy UI and compatibility HTTP adapters                 |
| `apps/api`                     | Independent Node REST/SSE/MCP listener and server services         |
| `packages/domain`              | Runtime schemas, entities, invariants, state transitions           |
| `packages/context-engine`      | Pure context building and deterministic three-way merge            |
| `packages/conversation-import` | Provider-neutral import IR and bounded ChatGPT export adapter      |
| `packages/application`         | Use cases, project-scoped RBAC, ports, transaction orchestration   |
| `packages/database`            | PostgreSQL schema, migrations, repositories, atomic unit of work   |
| `packages/model-provider`      | Qwen/vLLM OpenAI-compatible complete and streaming calls           |
| `packages/api-contracts`       | Runtime-validated HTTP request and response schemas                |
| `packages/agents`              | Persisted, scoped workflows that produce reviewable Deltas         |
| `packages/mcp-server`          | CCE Plugin MCP tools over the conversation-import application flow |
| `packages/test-support`        | Deterministic in-memory adapters and model doubles for tests       |

## 快速开始 / Quick start

### Prerequisites

开发机需准备以下工具；模型端点只在实际调用聊天、提取或 Agent 时使用。

- Node.js `24.x` (CI and the container use `24.19.0`)
- pnpm `11.22.0`
- Docker Engine or Docker Desktop with Compose for PostgreSQL and integration tests
- A Qwen/vLLM OpenAI-compatible endpoint only when exercising chat, extraction, or agent model calls

Enable the repository-pinned package manager and install the locked dependency graph:

```sh
corepack enable
corepack prepare pnpm@11.22.0 --activate
pnpm install --frozen-lockfile
```

Copy the environment template, then replace the development token and session secret:

```sh
cp .env.example .env
```

PowerShell equivalent:

```powershell
Copy-Item .env.example .env
```

The database CLI, `pnpm dev` backend and `pnpm start` load the repository-root `.env` while preserving
explicit process environment values. Vue only exposes its declared browser configuration.

数据库 CLI、开发后端和生产启动命令会加载根目录 `.env`；显式进程环境变量优先。也可用下列方式
导入当前 shell，或在 IDE/进程管理器中配置。

```sh
set -a
. ./.env
set +a
```

```powershell
Get-Content .env | Where-Object { $_ -match '^[^#][^=]*=' } | ForEach-Object {
  $name, $value = $_.Split('=', 2)
  Set-Item -Path "Env:$name" -Value $value
}
```

Start PostgreSQL, apply the forward-only migration, create the development identity/token, and start
the web service:

随后启动 PostgreSQL、执行只前进迁移、幂等创建开发身份与令牌，再启动 Web：

```sh
docker compose up -d --wait postgres
pnpm --filter @cce/database migrate
pnpm --filter @cce/database seed
pnpm dev
```

Open <http://localhost:5173> for Vue; API listens on <http://localhost:3001>.
`pnpm dev` starts Vue and API together without Next. To start independently, use two terminals:

```sh
pnpm dev:api
pnpm dev:frontend
```

Vite forwards `/api` and `/mcp` to port 3001. Set `CCE_API_PROXY_TARGET` in the frontend
process for a custom API port. The legacy host is available separately with `pnpm dev:legacy`.
Sign in with `CCE_SEED_API_TOKEN`; the raw token is never stored in the
database. `GET /api/health` is the database-aware readiness endpoint. Stop the development database with
`docker compose down`. Add `--volumes` only when intentionally deleting all local CCE database data.

### Database migration and seed behavior

迁移文件一经应用即视为不可变；seed 只存储令牌哈希，并可用同一身份和令牌安全重跑。

- `pnpm --filter @cce/database migrate` obtains a PostgreSQL advisory lock, applies committed SQL in a
  transaction, and records a SHA-256 checksum. Re-running an unchanged migration is safe.
- `pnpm --filter @cce/database seed` runs migrations first and idempotently creates the configured user
  and API token. It requires a valid email, a display name, and a token of at least 16 characters; the
  browser session contract requires at least 24 characters.
- Production uses one release-scoped migration job before compatible application replicas start.
  Never use schema push against shared or production databases.

## Environment variables

| Variable                           | Required / 何时需要 | Meaning / 含义                                                                                        |
| ---------------------------------- | ------------------- | ----------------------------------------------------------------------------------------------------- |
| `DATABASE_URL`                     | Yes                 | PostgreSQL URL used by API, migration, and seed processes                                             |
| `CCE_SESSION_SECRET`               | API                 | At least 32 bytes; derives the AES-256-GCM browser-session key                                        |
| `CCE_SEED_USER_EMAIL`              | Seed                | Development bootstrap user email                                                                      |
| `CCE_SEED_USER_NAME`               | Seed                | Development bootstrap display name                                                                    |
| `CCE_SEED_API_TOKEN`               | Seed                | Development token; use a unique random value, at least 24 characters for browser login                |
| `MODEL_BASE_URL`                   | API                 | Absolute OpenAI-compatible base URL, normally ending in `/v1`; no embedded credentials/query/fragment |
| `MODEL_API_KEY`                    | No                  | Bearer key; empty is permitted only for an intentionally unauthenticated local runtime                |
| `MODEL_CHAT_MODEL`                 | API                 | Concrete model used for interactive chat                                                              |
| `MODEL_EXTRACTOR_MODEL`            | API                 | Concrete model used for structured context extraction                                                 |
| `MODEL_CLASSIFIER_MODEL`           | API                 | Concrete model used for ambiguous semantic classification                                             |
| `MODEL_RESOLVER_MODEL`             | API                 | Concrete model used by complex/agent workflows                                                        |
| `MODEL_REQUEST_TIMEOUT_MS`         | API                 | Positive integer timeout in milliseconds, maximum 600000                                              |
| `POSTGRES_PORT`                    | Compose only        | Optional host port override; container port remains 5432                                              |
| `CCE_API_PORT`                     | API runtime         | HTTP port, default 3001                                                                               |
| `CCE_API_HOST`                     | API runtime         | Loopback by default; use 0.0.0.0 inside containers                                                    |
| `CCE_API_PUBLIC_ORIGIN`            | HTTPS ingress       | Fixed public origin for TLS termination; no path/credentials                                          |
| `CCE_ATTACHMENT_STORAGE_DIRECTORY` | Production API      | Absolute persistent private storage path                                                              |
| `VITE_APP_BASE`                    | Frontend only       | Public mount path; root scripts default to /                                                          |
| `VITE_CCE_API_BASE_URL`            | Frontend only       | Public API origin; empty uses same-origin routing                                                     |
| `CCE_MCP_ACCESS_TOKEN`             | Local Codex client  | CCE-issued bearer token read by the plugin connector; never consumed from conversation content        |

Only the server composition root reads concrete model names. Application and core code use the
`ModelProvider` port and logical purposes. Structured model responses are runtime-validated; provider
timeouts, rate limits, malformed output, and interrupted streams are normalized without exposing
credentials or raw prompts. See [Model platform](docs/model-platform.md).

具体模型名只在服务端组合根读取；核心代码仅依赖 `ModelProvider`。结构化输出必须通过运行时校验，
超时、限流、畸形输出和流中断会归一化为稳定错误，日志不会泄露密钥或原始提示词。

The root `.env` is a local-development convenience only. Production and container deployments inject
configuration and secrets explicitly through the runtime platform or secret manager; the repository
`.env` is optional and is not a production secret source. Existing Docker `--env-file` and `-e` values
continue to take precedence.

## UI 与 API / UI and API

The Web UI covers session login, project creation/listing, conversations and message evidence,
canonical context inspection, Delta extraction, merge review/resolution/finalization, and scoped Agent
runs. Permission-sensitive controls follow the same server-side Owner/Editor/Viewer checks as the API;
hiding a button is never the authorization boundary.

Web UI 覆盖登录、项目、对话证据、权威上下文、Delta 提取、合并审查/提交和受项目范围约束的 Agent
流程。Owner/Editor/Viewer 权限最终由服务端强制执行，前端隐藏按钮不构成授权边界。

REST resources are nested below Project. Main endpoints are:

```text
GET  /api/health
GET|POST|DELETE /api/session
GET|POST /api/projects
GET /api/projects/:projectId
GET|POST /api/projects/:projectId/members
PUT /api/projects/:projectId/members/:userId
GET|POST /api/projects/:projectId/conversations
POST /api/projects/:projectId/imports/preview
POST /api/projects/:projectId/imports
POST /api/projects/:projectId/imports/provider-previews
POST /api/projects/:projectId/imports/provider-submissions
GET /api/projects/:projectId/imports/:importId
GET|POST /api/projects/:projectId/conversations/:conversationId/messages
POST /api/projects/:projectId/conversations/:conversationId/chat        (SSE)
POST /api/projects/:projectId/conversations/:conversationId/deltas
POST /api/projects/:projectId/conversations/:conversationId/extract     (equivalent extraction route)
GET /api/projects/:projectId/context
GET /api/projects/:projectId/context/items
GET /api/projects/:projectId/context/commits
GET|POST /api/projects/:projectId/merge-requests
GET /api/projects/:projectId/merge-requests/:mergeRequestId
PUT /api/projects/:projectId/merge-requests/:mergeRequestId/conflicts/:conflictId/resolution
POST /api/projects/:projectId/merge-requests/:mergeRequestId/finalize
POST /api/projects/:projectId/agents/runs
GET /api/projects/:projectId/agents/runs/:runId
POST /api/projects/:projectId/agents/runs/:runId/resume
POST /api/projects/:projectId/agents/runs/:runId/cancel
GET|POST|DELETE /mcp                                              (standalone CCE API MCP transport)
```

The bundled [CCE conversation-submission plugin](docs/plugins/cce-plugin.md) provides an explicit preview-and-confirm workflow for messages and supplied materials from a supported ChatGPT/Codex invocation. Its separate preview summary covers accessible attachments, while important original material references remain unchanged in the import manifest. It stores only Conversation/Message evidence and never updates Project Context. ChatGPT official JSON export remains the separate bulk/high-fidelity import route; ZIP uploads are not accepted. The checked-in connector supports local Codex with a CCE bearer token; hosted ChatGPT requires a real HTTPS deployment and CCE-issued OAuth 2.1 flow before it can be represented as production-ready.

Use either an HttpOnly `cce_session` cookie created by `POST /api/session` or a bearer token. Browser
cookie mutations require a same-origin `Origin` header. Programmatic example:

浏览器使用 HttpOnly 会话 Cookie；脚本可直接发送 Bearer token。所有 Cookie 写请求必须同源。

```sh
curl -fsS http://localhost:3001/api/projects \
  -H "Authorization: Bearer $CCE_SEED_API_TOKEN"

curl -fsS -X POST http://localhost:3001/api/projects \
  -H "Authorization: Bearer $CCE_SEED_API_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name":"CCE demo"}'
```

All bodies, path values, query values, and responses are validated by `@cce/api-contracts`. Expected
status classes are 400 invalid transport syntax, 401 unauthenticated, 403 insufficient role, 404
inaccessible project-scoped resource, 409 stale/idempotency conflict, 422 domain invariant, 429 model
rate limit, and sanitized 500/503 failures. Merge finalization requires both `Idempotency-Key` and the
evaluated `expectedHeadCommitId`. See [API contracts](docs/api-contracts.md).

## 开发与验证 / Development and verification

快速本地门禁与外部系统门禁刻意分层：前者无需 Docker，后者必须连接真实 PostgreSQL/Chromium，
不会用 SQLite 或跳过测试伪装成功。

| Command                    | What it verifies                                                                        |
| -------------------------- | --------------------------------------------------------------------------------------- |
| `pnpm format:check`        | Prettier formatting without rewriting files                                             |
| `pnpm lint`                | ESLint type-aware rules and Next.js Core Web Vitals, zero warnings allowed              |
| `pnpm typecheck`           | Project references, tools/tests, and Web TypeScript boundaries                          |
| `pnpm test`                | Docker-free unit, contract, property, and component tests                               |
| `pnpm test:coverage`       | The same deterministic layer with enforced package/global thresholds                    |
| `pnpm test:integration`    | Real PostgreSQL 18.6 constraints, transactions, isolation, migrations, and repositories |
| `pnpm test:e2e`            | Real Next/PG Owner→Editor conflict/commit/chat path plus deterministic Viewer-denial UX |
| `pnpm test:e2e:standalone` | Vue/API session, attachment, image/video and review flows without Next                  |
| `pnpm build`               | Independent API JavaScript artifact and Vue static assets                               |
| `pnpm validate`            | Docker-free local gate: format, lint, typecheck, coverage, and independent build        |
| `pnpm verify:full`         | Local gate plus PostgreSQL integration and Playwright E2E                               |

`pnpm validate` intentionally does not imply full Definition of Done. Integration tests require a
working Docker-compatible container runtime because Testcontainers always starts the exact PostgreSQL
image; a missing runtime fails the suite rather than skipping it. E2E additionally needs PostgreSQL and
the installed Chromium binary (`pnpm exec playwright install chromium`). See
[Testing strategy](docs/testing.md) and [Development](docs/development.md).

## Production

```sh
pnpm build:frontend  # apps/vue/dist: deploy index.html + assets to any static host
pnpm build:api       # apps/api/dist; no Next build
pnpm db:migrate      # release-scoped migration before API startup
pnpm start:api       # independent Node process
```

The API artifact uses the existing `tsx` loader because workspace package exports currently
point to TypeScript source. Deploy it with the workspace packages and locked node_modules;
Vue requires only static files. Inject server environment values at runtime.

```sh
docker compose up -d --wait postgres
docker compose --profile tools run --rm migrator
docker compose up -d --build frontend api
```

Compose serves Vue at <http://localhost:8080>, API at <http://localhost:3001> and keeps
attachment bytes in a persistent private volume. Set a valid `CCE_SESSION_SECRET` first.
For public HTTPS, set `CCE_API_PUBLIC_ORIGIN=https://cce.example.com` and terminate TLS at ingress.
Compose forwards that optional value to API. Neither frontend nor API depends on Next.
See [Deployment](docs/deployment.md) for separate images, migration and rollback.

## Vue/API topology and MCP endpoint

Deployment routing is `/ → Vue`, `/api → API`, `/mcp → API`.
[nginx.conf](deployment/nginx.conf) implements this without Next and preserves streaming,
authorized attachment delivery and Range responses. Vue imports only browser contracts.
Development uses Vite's proxy to keep cookie requests same-origin while the listeners remain independent.

Public frontend values belong in `apps/vue/.env.local`: `VITE_APP_BASE` and
`VITE_CCE_API_BASE_URL` (empty for this same-origin gateway). An explicit API origin is public;
direct cross-origin browser authentication requires a separately implemented CORS policy.
Server `DATABASE_URL`, model keys, storage credentials and session/MCP secrets never belong
in `VITE_*` values. The frontend build never loads root `.env`; Docker excludes env files.
`pnpm verify:frontend` checks compiled browser assets for server imports and known credentials.

The local plugin calls <http://localhost:3001/mcp> directly and works with both UI hosts stopped.
Set `CCE_API_URL` and `CCE_MCP_ACCESS_TOKEN` in the Codex client process only. MCP authentication
uses persisted CCE tokens/RBAC; the API does not consume that client environment secret.
`GET /api/health` checks PostgreSQL and returns 503 on dependency failure; the static host's
`/frontend-health` checks only asset hosting. See [MCP setup](docs/plugins/cce-plugin.md).

## 故障排查 / Troubleshooting

排障时先确认进程环境、Docker/端口、PostgreSQL 迁移校验和模型网络；不要绕过 HEAD 并发检查、
迁移校验和或同源保护来“修复”症状。

- **`pnpm test:integration` cannot connect to Docker:** start Docker Engine/Desktop and verify
  `docker info`. The test suite deliberately has no SQLite fallback and no skip path.
- **Port 5432 is already in use:** set `POSTGRES_PORT` before `docker compose up`, and update the host
  port in `DATABASE_URL`, for example `POSTGRES_PORT=55432` with `localhost:55432`.
- **The CLI reports a migration checksum mismatch:** an already-applied SQL file was changed. Restore
  that immutable migration and add a new forward migration instead of modifying history.
- **Web startup reports invalid configuration:** confirm the process environment is loaded, the session
  secret is at least 32 bytes, the model URL is absolute HTTP(S), and the timeout is 1–600000.
- **Chat/extraction returns 503:** verify the vLLM endpoint and configured concrete model names from the
  Web container/network. Core project/context reads remain PostgreSQL-backed and do not require model
  availability.
- **Merge finalization returns 409:** the canonical project HEAD changed after evaluation. Reload and
  create/re-evaluate the merge request; do not retry with a fabricated expected HEAD.
- **A browser cookie mutation returns 403 while bearer calls work:** send it from the same origin as the
  CCE URL. Cookie-authenticated non-safe methods enforce an exact `Origin` match.

## License

Apache License 2.0. See [LICENSE](LICENSE).

### Standalone CCE submit plugin

Run `pnpm db:migrate` then `pnpm dev:api`; the local plugin targets `http://localhost:3001/mcp` (`CCE_API_PORT`). Next.js need not run. Provide `CCE_MCP_ACCESS_TOKEN` only through the Codex process environment. The server validates the CCE-issued credential and project permissions; no token belongs in prompts, Skills or checked-in configuration. For a custom port, align the local MCP URL and the attachment helper's `CCE_API_URL`.

Local attachments follow actual bytes → standalone attachment upload → attachmentId → original message attachmentIds → preview → confirmation → submit. They are never replaced by filename text. See [MCP setup and attachment workflow](docs/plugins/cce-plugin.md). Hosted ChatGPT still requires public HTTPS and OAuth 2.1; local bearer setup is not a hosted fallback.
