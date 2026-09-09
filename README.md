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
Browser
  -> Next.js UI + REST/SSE transport (apps/web)
  -> application use cases, RBAC, transactions
  -> domain invariants + deterministic context-engine
  -> PostgreSQL 18 repositories / OpenAI-compatible model adapter
```

This is a TypeScript modular monolith deployed as one Next.js service. Qwen/vLLM runs as an optional,
separate OpenAI-compatible service; provider state can be discarded without losing CCE history.
Canonical context history is linear, while each conversation branch retains the immutable base commit
that its participant saw. See [Architecture](docs/architecture.md),
[Domain model](docs/domain-model.md), and [merge semantics](docs/merge-semantics.md).

CCE 采用单体部署、模块化边界：Web/API、应用用例、领域规则、确定性合并、PostgreSQL 适配器和模型
适配器分别测试，但最终只部署一个 Next.js 服务。Qwen/vLLM 独立运行，供应商侧会话丢失不会损坏
CCE 的证据、版本或权威上下文。

| Workspace                      | Responsibility                                                     |
| ------------------------------ | ------------------------------------------------------------------ |
| `apps/web`                     | Accessible UI, REST/SSE routes, session adapter, composition root  |
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

The database CLI and `pnpm dev` consume the **process environment**; they do not implicitly load the
repository-root `.env`. Load it into the current shell before running commands.

数据库 CLI 和开发服务器读取的是**进程环境变量**，不会自动加载仓库根目录的 `.env`；运行前需用
下列方式导入当前 shell，或在 IDE/进程管理器中显式配置。

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
docker compose up -d --wait
pnpm --filter @cce/database migrate
pnpm --filter @cce/database seed
pnpm dev
```

Open <http://localhost:3000>. Sign in with `CCE_SEED_API_TOKEN`; the raw token is never stored in the
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

## 配置 / Configuration

| Variable                   | Required / 何时需要 | Meaning / 含义                                                                                        |
| -------------------------- | ------------------- | ----------------------------------------------------------------------------------------------------- |
| `DATABASE_URL`             | Yes                 | PostgreSQL URL used by Web, migration, and seed processes                                             |
| `CCE_SESSION_SECRET`       | Web                 | At least 32 bytes; derives the AES-256-GCM browser-session key                                        |
| `CCE_SEED_USER_EMAIL`      | Seed                | Development bootstrap user email                                                                      |
| `CCE_SEED_USER_NAME`       | Seed                | Development bootstrap display name                                                                    |
| `CCE_SEED_API_TOKEN`       | Seed                | Development token; use a unique random value, at least 24 characters for browser login                |
| `MODEL_BASE_URL`           | Web                 | Absolute OpenAI-compatible base URL, normally ending in `/v1`; no embedded credentials/query/fragment |
| `MODEL_API_KEY`            | No                  | Bearer key; empty is permitted only for an intentionally unauthenticated local runtime                |
| `MODEL_CHAT_MODEL`         | Web                 | Concrete model used for interactive chat                                                              |
| `MODEL_EXTRACTOR_MODEL`    | Web                 | Concrete model used for structured context extraction                                                 |
| `MODEL_CLASSIFIER_MODEL`   | Web                 | Concrete model used for ambiguous semantic classification                                             |
| `MODEL_RESOLVER_MODEL`     | Web                 | Concrete model used by complex/agent workflows                                                        |
| `MODEL_REQUEST_TIMEOUT_MS` | Web                 | Positive integer timeout in milliseconds, maximum 600000                                              |
| `POSTGRES_PORT`            | Compose only        | Optional host port override; container port remains 5432                                              |
| `PORT`                     | Container/runtime   | HTTP port, default 3000                                                                               |
| `CCE_MCP_ACCESS_TOKEN`     | Local Codex client  | CCE-issued bearer token read by the plugin connector; never consumed from conversation content        |

Only the Web composition root reads concrete model names. Application and core code use the
`ModelProvider` port and logical purposes. Structured model responses are runtime-validated; provider
timeouts, rate limits, malformed output, and interrupted streams are normalized without exposing
credentials or raw prompts. See [Model platform](docs/model-platform.md).

具体模型名只在 Web 组合根读取；核心代码仅依赖 `ModelProvider`。结构化输出必须通过运行时校验，
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
GET|POST|DELETE /mcp                                              (CCE Plugin MCP transport)
```

The bundled [CCE conversation-submission plugin](docs/plugins/cce-plugin.md) provides an explicit preview-and-confirm workflow for messages supplied by a supported ChatGPT/Codex invocation. It stores only Conversation/Message evidence and never updates Project Context. ChatGPT official JSON/ZIP export remains the separate bulk/high-fidelity import route. The checked-in connector supports local Codex with a CCE bearer token; hosted ChatGPT requires a real HTTPS deployment and CCE-issued OAuth 2.1 flow before it can be represented as production-ready.

Use either an HttpOnly `cce_session` cookie created by `POST /api/session` or a bearer token. Browser
cookie mutations require a same-origin `Origin` header. Programmatic example:

浏览器使用 HttpOnly 会话 Cookie；脚本可直接发送 Bearer token。所有 Cookie 写请求必须同源。

```sh
curl -fsS http://localhost:3000/api/projects \
  -H "Authorization: Bearer $CCE_SEED_API_TOKEN"

curl -fsS -X POST http://localhost:3000/api/projects \
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

| Command                 | What it verifies                                                                        |
| ----------------------- | --------------------------------------------------------------------------------------- |
| `pnpm format:check`     | Prettier formatting without rewriting files                                             |
| `pnpm lint`             | ESLint type-aware rules and Next.js Core Web Vitals, zero warnings allowed              |
| `pnpm typecheck`        | Project references, tools/tests, and Web TypeScript boundaries                          |
| `pnpm test`             | Docker-free unit, contract, property, and component tests                               |
| `pnpm test:coverage`    | The same deterministic layer with enforced package/global thresholds                    |
| `pnpm test:integration` | Real PostgreSQL 18.6 constraints, transactions, isolation, migrations, and repositories |
| `pnpm test:e2e`         | Real Next/PG Owner→Editor conflict/commit/chat path plus deterministic Viewer-denial UX |
| `pnpm build`            | TypeScript workspace plus production Next.js standalone output                          |
| `pnpm validate`         | Docker-free local gate: format, lint, typecheck, coverage, and build                    |
| `pnpm verify:full`      | Local gate plus PostgreSQL integration and Playwright E2E                               |

`pnpm validate` intentionally does not imply full Definition of Done. Integration tests require a
working Docker-compatible container runtime because Testcontainers always starts the exact PostgreSQL
image; a missing runtime fails the suite rather than skipping it. E2E additionally needs PostgreSQL and
the installed Chromium binary (`pnpm exec playwright install chromium`). See
[Testing strategy](docs/testing.md) and [Development](docs/development.md).

## 容器与部署 / Containers and deployment

Build the non-root Next.js standalone runtime:

生产镜像采用多阶段构建，最终以非 root `node` 用户运行；迁移镜像和应用镜像必须来自同一修订。

```sh
docker build --target runner -t cce:local .
```

Build and execute the release migration target once, then start the application with runtime secrets
injected by the platform:

```sh
docker build --target migrator -t cce-migrator:local .
docker run --rm --network cce-network \
  -e DATABASE_URL=postgresql://cce:secret@postgres:5432/cce \
  cce-migrator:local

docker run --rm --network cce-network -p 3000:3000 \
  --env-file /secure/path/cce.env \
  cce:local
```

The final image runs as the image's unprivileged `node` user, contains the Next standalone runtime and
Apache-2.0 license, and checks `/api/health`. The development Compose file is not a production topology. Production
must provide TLS ingress, restricted database/model networks, managed secrets, PostgreSQL backups with
tested restore, connection limits, logs/metrics, and a single ordered migration job. See
[Deployment](docs/deployment.md) and [Operations](docs/operations.md).

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
