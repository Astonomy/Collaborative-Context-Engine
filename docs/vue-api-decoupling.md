# Vue / Next.js 解耦最终验收

## 当前 Scope C — 2026-10-24–27

**DECOUPLED: YES**。A/B/C/D 全部 PASS，无剩余签收 blocker。

| Gate            | 结论     | 最终证据                                                                                                                                 |
| --------------- | -------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| A. Architecture | **PASS** | Vue → standalone API；Plugin → standalone API；API → server-runtime/application/domain/adapters；source、bundle、生产镜像无 Next runtime |
| B. Runtime      | **PASS** | 真实 PostgreSQL integration 34/34；两组真实 Chromium E2E 各 5/5；认证、业务、媒体、SSE、MCP/Plugin 均通过                                |
| C. Production   | **PASS** | 当前源码新镜像；HTTPS/nginx 123 项检查；镜像替换前数据保留及 API/frontend/PostgreSQL 重启各 23 项检查通过                                |
| D. Quality      | **PASS** | lint/typecheck/build/format/verify:frontend/coverage/runtime audit 全部 exit 0，无阈值降低或断言跳过                                     |

最终结果：integration 34/34、standalone E2E 5/5、decoupling E2E 5/5；新镜像 HTTPS/nginx 完整业务 123 项检查通过，API/frontend/PostgreSQL 重启后每轮 23 项持久化与浏览器检查通过。全部质量命令 exit 0。

本轮修复了 PostgreSQL 重启时空闲连接池 error 未处理导致 API 退出的问题，增加单元与真实数据库恢复回归；修正 SSE 浏览器取证和图扫描局部执行超时，保留所有业务断言、RBAC、人工审批及质量阈值。没有架构重构或删除 Next。

实际命令、退出码、测试数量、最终 image ID、HTTP 状态、数据库/媒体持久化证据及全部失败记录见
[Scope C 最终验收](verification/final-decoupling-acceptance.md)。隔离 project 为 `cce-scope-c-1792828379`，测试数据与两个独立卷均保留。

以下保留 2026-10-16 的历史原始记录，**不作为 2026-10-24 本轮结论或证据**。

## 历史验收 — 2026-10-16

验收日期：2026-10-16（Asia/Shanghai），本轮从 16:16 开始。**DECOUPLED: NO**。

当前源码的 Architecture Gate 通过；Runtime、Production、Quality Gate 失败。生产镜像可构建、容器 healthy、Vue 可挂载，均不能替代数据库迁移、成功认证及业务流程验收。

| Gate            | 结论     | 本轮直接证据                                                                                                                                              |
| --------------- | -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A. Architecture | **PASS** | 已确认恢复路径完整；新编译产物审计：513 API imports、128 Vue modules、22 JS assets，无 Next runtime / server-side browser dependency；Plugin 指向独立 API |
| B. Runtime      | **FAIL** | 真实 PostgreSQL migration 退出 1；integration 3 suites 初始化失败、31 个测试体未执行；两组 standalone E2E 均在 migration 阶段退出 1                       |
| C. Production   | **FAIL** | 新 image 构建、nginx、TLS、Vue 挂载和无 Next 重启检查通过；HTTPS 登录实际 500，MCP/Plugin 实际调用失败；成功媒体/SSE/业务持久化检查 BLOCKED               |
| D. Quality      | **FAIL** | typecheck、build、frontend audit、完整 unit/coverage 通过；全仓 lint 退出 1，format 退出 2                                                                |

标记规则：必需命令或检查已实际失败为 FAIL；依赖失败、成功路径尚不能执行为 BLOCKED；只有完成对应检查并得到满足要求的结果才为 PASS。**只有四个 Gate 全部 PASS 才允许 DECOUPLED: YES。**

## 基线、报告与隔离

已读取 [H0](verification/h0-recovery-audit.md)、[H1](verification/h1-source-recovery.md)、[H2](verification/h2-build-recovery.md)、[H3](verification/h3-runtime-acceptance.md)、[H4](verification/h4-production-acceptance.md)。H0 的缺失源码结论已由 H1/H2 恢复进展取代；H3/H4 的 0006 迁移问题在本轮再次复现。上述报告用于来源和问题背景；以下通过/失败结论来自本轮命令，**没有使用 2026-10-08 或其他历史成功结果代替当前运行证据**。

- 工作区：`D:\code\Collaborative-Context-Engine`，HEAD `f66227d72a7d7b3c94a9030bbe6add2dff61647e`，包含现存未提交恢复/迁移。未修改实现、迁移、测试断言或质量配置。
- Windows Node 24.15.0、pnpm 11.22.0；Docker 在 Ubuntu WSL，Engine 29.7.2。使用既有安装执行本轮检查；Docker 中重新执行 frozen 依赖获取/安装及构建。
- 新 Compose project：`cce-final-20261016`；loopback 端口 HTTP `58184`、HTTPS `58544`、API `53114`、PostgreSQL `55544`。
- 外部 env：WSL `/home/ssh/.local/share/cce-final-20261016/acceptance.env`，目录 700、文件 600，使用本轮随机数据库密码/session secret；凭据没有写入文档。见 [权限](../agent/log/final-decoupling-20261016/env-permissions.txt)。未修改仓库 `.env`。
- Runtime runner 通过仅对子进程设置 `TEST_DATABASE_URL` 访问本轮 PostgreSQL 的 `postgres` maintenance database，每次创建随机空测试库并在 finally 清理；不使用开发/生产数据库。生产验收另用该隔离实例中的空库 `cce`。
- 本轮证据目录：[final-decoupling-20261016](../agent/log/final-decoupling-20261016)。每项命令有独立 `.exit` 文件；shell 日志采集命令完成不等于其中 pnpm/Docker 子命令通过。

## A. Architecture — PASS

H0 inventory 的 221 个路径实际核对：220 个已确认路径均存在，唯一不存在的是 H1 明确标为历史存在性未确认的 `apps/api/server.ts`；它不是当前 import 依赖，实际入口为 `main.ts → http-server.ts → router.ts`。没有据建议文件名生成占位入口。见 [inventory](../agent/log/final-decoupling-20261016/source-inventory.json)、[核对输出](../agent/log/final-decoupling-20261016/source-inventory.log)，核对退出 0。

| 检查 / 实际命令                               | 退出码 | 结果和证据                                                                                                                                                                                                                            |
| --------------------------------------------- | -----: | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm typecheck`                              |      0 | shared/tools/API/web/Vue 检查通过；[log](../agent/log/final-decoupling-20261016/typecheck.log)                                                                                                                                        |
| `pnpm build`                                  |      0 | 先清理后重新构建 API/shared 和 Vue；[log](../agent/log/final-decoupling-20261016/build.log)                                                                                                                                           |
| `node scripts/audit-runtime-dependencies.mjs` |      0 | 513 API imports、128 Vue modules；生产 workspace 依赖和 API source graph 无 Next；[log](../agent/log/final-decoupling-20261016/runtime-audit.log)、[本轮 graph](../agent/log/final-decoupling-20261016/vue-api-dependency-graph.json) |
| `pnpm verify:frontend`                        |      0 | 重新构建的 Vue 22 JS 文件含 worker，无被禁服务器代码/凭据标识；[log](../agent/log/final-decoupling-20261016/frontend-audit.log)、[artifact scan](../agent/log/final-decoupling-20261016/s8-browser-audit.json)                        |
| `pnpm test:coverage`                          |      0 | 包含 workspace exports、server-only 条件导出、API transitive graph 和 Plugin endpoint 边界测试；[log](../agent/log/final-decoupling-20261016/coverage.log)                                                                            |

Vue build 的 `browserBoundary` 在模块解析和 bundle 生成阶段检查 Node builtins、API/web/database/storage/model-provider 等服务器入口；artifact scan 为补充检查。审计使用本轮新 Vue bundle，不沿用旧 dist。生成的 graph/audit 已复制到本轮目录，原有其他验收 artifact 保留原内容。

Plugin `.mcp.json` 当前指向 `http://localhost:3001/mcp`；真实上传 helper 默认同一 standalone API origin。本轮实际调用通过 `CCE_API_URL=http://127.0.0.1:53114` 覆盖测试端口。静态指向检查通过不代表 MCP 业务调用通过。

## B. Runtime — FAIL

| 实际命令                                                                             | 退出码 | 本轮结果 / 证据                                                                                                                                    |
| ------------------------------------------------------------------------------------ | -----: | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm test:integration`                                                              |      1 | 3 suites 的 beforeAll migration 失败；31 tests skipped（未进入测试体，非新增 skip）；[log](../agent/log/final-decoupling-20261016/integration.log) |
| `pnpm test:e2e:standalone`                                                           |      1 | runner 空库 migration 失败，Playwright 和模型 fixture 未启动；[log](../agent/log/final-decoupling-20261016/e2e-standalone.log)                     |
| `pnpm test:e2e:decoupling`                                                           |      1 | 同一真实 migration 错误，浏览器业务流程未运行；[log](../agent/log/final-decoupling-20261016/e2e-decoupling.log)                                    |
| `pnpm exec playwright test --config apps/vue/playwright.standalone.config.ts --list` |      0 | 仅收集 3 files / 5 tests，**不计为运行通过**；[list](../agent/log/final-decoupling-20261016/standalone-test-list.log)                              |
| Docker migrator（见 C 的完整命令）                                                   |      1 | 新镜像在真实 PostgreSQL 18.6 空库执行同样失败；[log](../agent/log/final-decoupling-20261016/migration.log)                                         |

直接失败：`packages/database/migrations/0006_import_attachment_uploads.sql:2` 引用 `projects(id)`，但 `0001_initial.sql` 的主键为 `projects.project_id`。PostgreSQL 返回 SQLSTATE **42703**：`column "id" referenced in foreign key constraint does not exist`。migration 注册包含六项，事务整体回滚；生产验收空库 public schema 实际为 **0 tables**，见 [查询](../agent/log/final-decoupling-20261016/database.txt)、[服务端 SQL/error](../agent/log/final-decoupling-20261016/postgres.log)。没有跳过迁移、手工补兼容 schema 或预置旧数据库。

| Runtime 成功路径                                          | 状态                          |
| --------------------------------------------------------- | ----------------------------- |
| 空库 migrations                                           | FAIL                          |
| integration / Vue standalone E2E 完整通过                 | BLOCKED：初始化失败，不能签收 |
| 持久身份/session/RBAC、业务写入、review/commit            | BLOCKED                       |
| 上传、关联、授权下载、video 206/416 Range                 | BLOCKED                       |
| SSE 实际事件、完成/取消                                   | BLOCKED                       |
| MCP initialize/tools/call、Plugin preview/submit/文件绑定 | BLOCKED；实际尝试失败见 C     |

## C. Production — FAIL

实际在 WSL 仓库目录执行以下命令，所有 compose 操作均使用同一 project 和外部 env；TLS override 增加同一 frontend nginx 的 443 入口，代理到原始 80 路由，不替换仓库 `/api`、`/mcp` 配置。

```sh
E=/home/ssh/.local/share/cce-final-20261016/acceptance.env
T=/home/ssh/.local/share/cce-final-20261016/compose-tls.yaml
docker compose -p cce-final-20261016 --env-file "$E" build --no-cache api frontend migrator
docker compose -p cce-final-20261016 --env-file "$E" up -d --wait postgres
docker compose -p cce-final-20261016 --env-file "$E" -f compose.yaml -f "$T" run --rm --no-deps migrator
docker compose -p cce-final-20261016 --env-file "$E" -f compose.yaml -f "$T" up -d --no-build --wait api frontend
docker compose -p cce-final-20261016 --env-file "$E" -f compose.yaml -f "$T" restart api frontend
docker compose -p cce-final-20261016 --env-file "$E" -f compose.yaml -f "$T" up -d --no-build --wait api frontend
```

退出码按顺序为 **0、0、1、0、0、0**。见 [build](../agent/log/final-decoupling-20261016/images-build.log)、[PostgreSQL startup](../agent/log/final-decoupling-20261016/postgres-start.log)、[migration](../agent/log/final-decoupling-20261016/migration.log)、[startup](../agent/log/final-decoupling-20261016/services-start.log)、[restart](../agent/log/final-decoupling-20261016/restart.log)。完整生产采集脚本见 [production-command.txt](../agent/log/final-decoupling-20261016/production-command.txt)。没有将 `compose config` 或 healthcheck 当作部署成功。

### 实际 image / container

API/frontend/migrator 均为本轮 `--no-cache` 新构建，未使用 H4 或其他旧应用 image。实际 [image ID 与创建时间](../agent/log/final-decoupling-20261016/images.txt)：

| Image      | ID                                                                        |
| ---------- | ------------------------------------------------------------------------- |
| API        | `sha256:727700d59e688599f593873b4d5cfc9e20c31b31bec6a8efab49c8404b431338` |
| frontend   | `sha256:a48ee1f6176ad395796fc4194435b2497bca52a1df3508e0dfa142524441dee4` |
| migrator   | `sha256:97dae1ce37abf125a5a15e05af97f102945e1898842e0034578a786093f6283b` |
| PostgreSQL | `sha256:b07129cc272f688c98f5b343138a0a52fa45b3d82f50d7a53ff441330624cd2e` |

| Container                       | ID 前缀        | 运行验收状态      |
| ------------------------------- | -------------- | ----------------- |
| `cce-final-20261016-api-1`      | `2a5e979853e1` | running / healthy |
| `cce-final-20261016-frontend-1` | `d21183eb48f2` | running / healthy |
| `cce-final-20261016-postgres-1` | `bba61424cbc3` | running / healthy |

完整 ID/运行镜像/mounts 见 [inspect](../agent/log/final-decoupling-20261016/inspect.txt)，端口见 [containers](../agent/log/final-decoupling-20261016/containers.txt)。最终 API image 实际以 uid 1000 运行 `node --import tsx dist/apps/api/main.js`，没有 next/react/react-dom/.next 安装目录或 `apps/web`；容器内 next/react/react-dom/@cce/web 解析均不可达，两个审计命令退出 0，见 [image audit](../agent/log/final-decoupling-20261016/image-audit.txt)。`nginx -t` 退出 0，见 [log](../agent/log/final-decoupling-20261016/nginx-test.log)。

### 实际 nginx / HTTPS / HTTP

HTTPS curl 均使用本轮证书 `--cacert`，没有使用 `-k`；本地自签名 TLS 不证明公网 ingress/DNS/CA 部署。两轮每个 curl 的退出码均为 0，表示传输完成，**不表示对应业务成功**。见 [原始首次结果](../agent/log/final-decoupling-20261016/http.txt)、[重启后结果](../agent/log/final-decoupling-20261016/http-after-restart.txt)、[状态汇总](../agent/log/final-decoupling-20261016/http-summary.txt)。

| 请求                                         | 重启前 / 后 HTTP | 结论                                                                                 |
| -------------------------------------------- | ---------------- | ------------------------------------------------------------------------------------ |
| `/`、SPA deep link                           | 200 / 200        | 同一 Vue HTML；fallback 字节比较退出 0                                               |
| 实际 `/assets/index-BSBodv6p.js`             | 200 / 200        | 197072 bytes JavaScript，immutable cache                                             |
| 缺失 `/assets/h4-missing.js`                 | 404 / 404        | 不 fallback 到 Vue                                                                   |
| `/api/health`                                | 200 / 200        | API/PG 可达；仅 `select 1`，schema 仍为空                                            |
| 未知 `/api/h4-missing`                       | 404 / 404        | 空 body，无 SPA fallback                                                             |
| 匿名 GET `/api/session`                      | 401 / 401        | API 认证边界                                                                         |
| 同源 POST `/api/session`，专用无效测试 token | 500 / 500        | `api_tokens` 表不存在；HTTPS auth **FAIL**，未建立合法 session                       |
| 同源 DELETE `/api/session`                   | 200 / 200        | 清除 cookie 带 Secure/HttpOnly/SameSite=strict/Max-Age=0；不能替代登录及 cookie 往返 |
| 匿名 POST `/mcp` initialize                  | 401 / 401        | MCP 路由到 API，不证明握手成功                                                       |
| 匿名上传、下载、带 Range 的 content GET      | 401 / 401        | 未验证授权成功、真实媒体字节或 206/416                                               |
| 匿名 chat，Accept text/event-stream          | 401 / 401        | 未产生 SSE，streaming 验收 BLOCKED                                                   |

API 日志记录 `relation "api_tokens" does not exist`（42P01），见 [log](../agent/log/final-decoupling-20261016/api.log)。因此 health 200、Cookie 清除标志正确与认证业务失败同时存在。

### Browser、MCP/Plugin、Next 停止及持久化

| 实际调用                                                                                                             | 退出码 | 结果                                                                                                                                                                                  |
| -------------------------------------------------------------------------------------------------------------------- | -----: | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `node --input-type=module`，执行 [browser-command](../agent/log/final-decoupling-20261016/browser-command.txt)       |      0 | 新启动 Chromium 实际挂载 Vue 登录页，请求仅到 `https://localhost:58544`，无 :3000；[log](../agent/log/final-decoupling-20261016/browser.log)                                          |
| `node --input-type=module`，执行 [mcp-plugin-command](../agent/log/final-decoupling-20261016/mcp-plugin-command.txt) |      1 | 标准 MCP SDK 直连 :53114 initialize 得到 500；真实 Plugin helper 读取临时 PNG 并实际上传，得到 500，未提交 conversation；[log](../agent/log/final-decoupling-20261016/mcp-plugin.log) |

这两项通过参数化已有探针源码在**本轮新端点重新执行**，不是复制 H4 运行输出。浏览器对本地自签名证书使用 `ignoreHTTPSErrors`，TLS 信任由 curl 独立校验。MCP/Plugin 使用合规格式测试 UUID、无效测试 token 和临时合成图片，没有合法持久身份，也没有使用用户对话或用户文件。

本轮 Next 始终停止：WSL 容器和 listener 无 Next/:3000，见 [no-next](../agent/log/final-decoupling-20261016/no-next.txt)；Windows :3000 listener 为 0，见 [Windows 检查](../agent/log/final-decoupling-20261016/windows-no-next.txt)。当前可执行的静态/路由/认证失败响应和 Vue 挂载在 Next 不运行时得到验证，重启 API/frontend 后重复 14 个 HTTP 探针，状态一致。**这不能证明登录后整个系统仍工作。**

数据库和附件 volume 挂载保持，但没有成功迁移或业务写入，无法验证重启后的 Project/Message/Commit/附件数据。SSE、video Range、外部 ModelProvider、合法 MCP tools/call、Plugin preview/submit 成功链路均 BLOCKED。nginx buffering 配置不能替代真实 streaming 证据。

采集结束仅执行本轮 project 的 `compose stop api frontend postgres`，退出 0，最终三个容器均 Exited (0)，见 [stop](../agent/log/final-decoupling-20261016/stop.log)、[最终状态](../agent/log/final-decoupling-20261016/final-containers.txt)。未删除任何真实数据库 volume；本轮两个 volume 也保留，见 [清单](../agent/log/final-decoupling-20261016/preserved-volumes.txt)。外部安全 env/证书保留以供复核。

## D. Quality — FAIL

| 本轮实际命令           | 退出码 | 结果 / 证据                                                                                                                                                                                        |
| ---------------------- | -----: | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm lint`            |      1 | 4527 errors，0 warnings；79 个报错文件均在 `CCE-h1-recovery` 恢复材料范围内，包含 candidate 副本解析/类型错误及 replay.cjs；全仓命令仍失败；[log](../agent/log/final-decoupling-20261016/lint.log) |
| `pnpm typecheck`       |      0 | [log](../agent/log/final-decoupling-20261016/typecheck.log)                                                                                                                                        |
| `pnpm build`           |      0 | API/shared 清理编译及 Vue typecheck/production build；[log](../agent/log/final-decoupling-20261016/build.log)                                                                                      |
| `pnpm format:check`    |      2 | candidate `ImagePreview.vue` 解析错误，多份恢复材料格式问题；另有 H4 browser/MCP 证据脚本格式 warning；[log](../agent/log/final-decoupling-20261016/format.log)                                    |
| `pnpm verify:frontend` |      0 | 新 bundle 22 JS assets；[log](../agent/log/final-decoupling-20261016/frontend-audit.log)                                                                                                           |
| `pnpm test:coverage`   |      0 | root 66 files / 531 tests、Vue 18 files / 142 tests、Plugin 4 tests 全部通过；原覆盖率门槛保留；[log](../agent/log/final-decoupling-20261016/coverage.log)                                         |

`test:coverage` 实际命令链为 `vitest run --coverage && pnpm --filter @cce/vue test:coverage && pnpm test:plugin`，已经执行所需单元测试及 Plugin 脚本测试，没有用局部筛选代替完整 unit/coverage。Root statements 91.64%、branches 84.56%、functions 96.15%、lines 92.28%；Vue lines 98.69%、branches 88.35%。见 [root coverage](../agent/log/final-decoupling-20261016/root-coverage-summary.json)、[Vue coverage](../agent/log/final-decoupling-20261016/vue-coverage-summary.json)。

没有为了取得绿色结果移动恢复材料、扩大 ignore、关闭 lint、调低覆盖率、修改测试断言或跳过失败检查。全仓 D Gate 的失败与当前活动源码的 typecheck/build/unit 通过分别记录。

## 剩余问题与 Legacy 状态

1. 修复 0006 外键契约后，重新以全新隔离 PostgreSQL 空库验证全部迁移，重跑 integration、standalone 与 decoupling E2E；当前没有成功业务测试证据。
2. 迁移通过后，需要有效持久身份完成 HTTPS 登录/cookie session 往返及 RBAC，再验证授权上传/下载、video 206/416、实际 SSE 完成/取消、MCP/Plugin preview/submit/附件绑定，以及重启后数据库记录与附件字节仍存在。
3. 处理导致全仓 lint/format 失败的仓库内恢复材料及证据脚本；本轮未静默缩小检查范围。重新通过完整 Quality Gate 后才能签收 D。

`apps/web`、Next.js legacy dependencies、legacy scripts/tests 均保留；本轮没有删除 Next 或修改锁文件。Architecture PASS 只确认当前静态/构建边界，不能替代 B/C/D。**DECOUPLED: NO**。
