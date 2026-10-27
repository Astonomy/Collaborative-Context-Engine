# Scope A — Database Migration & Runtime Foundation

验收日期：2026-10-24（Asia/Shanghai）。本次使用 Ubuntu WSL2、Node 24.22.0、pnpm 11.22.0、真实 PostgreSQL 18.6；结果来自本轮执行。

数据库迁移及 integration **PASS**；完整 Runtime 验收仍受浏览器 SSE 取证阻塞，不能标记 DECOUPLED=YES。未修改原验收结论、业务页面、MCP/Plugin、审批/commit 语义或 Docker/nginx 配置。

## 根因与最小修复

`0001_initial.sql` 定义 `projects.project_id uuid PRIMARY KEY`。`0006_import_attachment_uploads.sql` 错误引用不存在的 `projects.id`，PostgreSQL 返回 SQLSTATE 42703。现有 runner 在一个事务中执行全部待应用迁移，因此错误会回滚整个批次及首次创建的版本登记表。

唯一业务 SQL 修改：

```diff
- project_id uuid NOT NULL REFERENCES projects(id) ON DELETE RESTRICT,
+ project_id uuid NOT NULL REFERENCES projects(project_id) ON DELETE RESTRICT,
```

没有新增兼容列、移除约束、关闭迁移或手工写入版本记录。修复前本轮重新运行 integration，3 suites 初始化失败，33 tests 未进入测试体，原错误见 [integration-regression.log](../../agent/log/fix-database-runtime/integration-regression.log)。这些是 hook 失败导致的未执行，不是新增 skip。

同时修复两处测试基础设施问题：

- `scripts/run-postgres-tests.mts` 将空 `TEST_DATABASE_URL` 统一归为未配置。此前空值启动 Testcontainers 后却被 `??` 保留，导致 `No test PostgreSQL available`；仍复用原 runner。
- `apps/vue/playwright.standalone.config.ts` 的就绪地址改为经 Vite 代理的 `/api/health`。原静态页面先就绪，首个登录请求可能得到 502 / ECONNREFUSED。只修改测试启动探针，没有修改页面和现有测试断言。

## Schema / FK 审计

逐项读取 0001–0006、迁移 registry/CLI、数据库 schema/附件 repository、隔离 runner 与 integration fixtures。全部六个文件按顺序登记，无缺项、重复项。SQL 是创建结构的依据，Drizzle 不负责运行时自动建表。

| 对象                      | 实际契约                                                                                                                                                           |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| projects                  | `project_id` UUID 主键；创建者 → `users(id)`；HEAD 使用 `(project_id, head_commit_id)` → `context_commits(project_id,id)`，可延迟检查                              |
| conversations             | `(project_id,id)` 复合主键；项目 → `projects(project_id)`；branch 使用项目复合键，可延迟检查                                                                       |
| messages                  | `(project_id,id)` 主键；`(project_id,conversation_id,id)` 唯一；会话及 reply 外键保留项目/会话范围                                                                 |
| attachments               | `(project_id,id)` 主键；`(project_id,conversation_id,message_id)` → `messages(project_id,conversation_id,id)`，RESTRICT、DEFERRABLE INITIALLY DEFERRED             |
| attachment_events         | `(project_id,attachment_id)` → `attachments(project_id,id)`；事件序号唯一                                                                                          |
| import_attachment_uploads | 两个 FK：`project_id` → `projects(project_id)`，`actor_user_id` → `users(id)`；两侧均 UUID，RESTRICT                                                               |
| import upload identity    | `(project_id,id)` 主键；`(project_id,actor_user_id,upload_id)` 唯一。暂存记录尚未绑定消息，无独立 conversation/message FK；提交后的附件由 attachments 复合 FK 约束 |
| identity                  | `users(id)` UUID 主键；`api_tokens.token_hash` 主键，`user_id` → `users(id)`                                                                                       |

0002 增加 import 记录；0003 增加 provider previews 及 import 校验；0004 替换 ZIP 导入 CHECK（原有 `NOT VALID` 保留，不影响新行检查）；0005 增加附件和事件；0006 增加上传暂存。0005/0006 的 append-only trigger 依赖 0001 已建立的函数，顺序正确。

新增两项真实 DB 回归测试：合法上传插入成功；无效项目、无效用户分别返回 23503；重复上传 identity 返回 23505；读取实际附件 FK 定义与唯一索引，并查询整个 public schema 的 FK 列类型，未发现两侧类型不一致。原有附件测试继续覆盖合法绑定、孤儿回滚、跨项目/会话限制、不可变事件和 checksum。

首次新增索引检查误猜了 PostgreSQL 自动缩短的名称，导致一次 32 pass / 1 fail。实际名称为 `import_attachment_uploads_project_id_actor_user_id_upload_i_key`；新增检查改为验证唯一索引及完整列定义，未放宽唯一性要求，也未改动既有断言。最终数据库测试 14/14 通过。

## 迁移兼容性与重复执行

0006 在本地为未跟踪文件，`git log --all -- packages/database/migrations/0006_import_attachment_uploads.sql` 无历史。已知 H3/H4/最终验收均失败并回滚；本轮在实际 0001 schema 上再次复现，原 0006 不可能在该 schema 上成功应用。因此按未成功应用的开发迁移修复原文件。

没有可用的外部生产环境清单，本报告不声称已查询所有远端部署。若另一个环境存在已应用 0006 的记录，说明其 schema/迁移内容不同，需要先核对该环境历史，不能直接覆盖 checksum。当前 runner 的历史 checksum 不一致即报错机制完整保留。

registry 按 0001–0006 顺序执行；事务级 advisory lock 串行化 migrator；每项记录 SHA-256；相同文件再次运行返回 `already_applied`。原始 DDL 本身不设计为重复执行，幂等性由现有 runner 提供。integration 验证二次执行，Compose 验证 PostgreSQL 重启后由新的 migrator 进程再次检查。

## 本轮命令与结果

命令在仓库 WSL 路径执行。三组测试对子进程设置 `TEST_DATABASE_URL=`，使原 runner 使用新 Testcontainers 实例，创建随机 `cce_test_<uuid>` 空库，finally 删除该随机库、关闭连接、停止容器并清理临时附件目录；不连接开发/生产业务库。命令记录器见 [run-check.sh](../../agent/log/fix-database-runtime/run-check.sh)，每次保存 `.log` 和 `.exit`。

| 命令                                                 | 退出码 | 实际结果                                                                                                          |
| ---------------------------------------------------- | -----: | ----------------------------------------------------------------------------------------------------------------- |
| `CI=true pnpm install --frozen-lockfile`             |      0 | WSL 依赖按锁文件安装，无依赖版本修改                                                                              |
| `pnpm test:integration`（修复前）                    |      1 | 3 suites 初始化失败，33 tests 未执行                                                                              |
| `pnpm test:integration`（修复后最终）                |      0 | **33 passed / 0 failed / 0 skipped**，3 files；[日志](../../agent/log/fix-database-runtime/integration-final.log) |
| `pnpm test:e2e:standalone`（浏览器安装及就绪修复后） |      1 | **4 passed / 1 failed**；[日志](../../agent/log/fix-database-runtime/e2e-standalone-ready.log)                    |
| `pnpm test:e2e:decoupling`                           |      0 | **5 passed / 0 failed**；[日志](../../agent/log/fix-database-runtime/e2e-decoupling.log)                          |
| `pnpm exec vitest run packages/database/src`         |      0 | 5 files，**18 passed / 0 failed**；[日志](../../agent/log/fix-database-runtime/database-unit.log)                 |
| `pnpm typecheck`                                     |      0 | 全仓类型检查通过；[日志](../../agent/log/fix-database-runtime/typecheck.log)                                      |
| 变更 TS 文件 ESLint                                  |      0 | 无警告；[日志](../../agent/log/fix-database-runtime/lint-final.log)                                               |
| 变更文件 Prettier check                              |      0 | 全部通过；[日志](../../agent/log/fix-database-runtime/format-check.log)                                           |

首轮环境失败保留在日志：默认 WSL Node 18 / Windows Volta 路径不可用，切换已有 Linux Node 24；原 `.env` maintenance 地址连接被拒绝；空 maintenance 值触发 runner bug；首轮 E2E 缺 Chromium 1234（5 failed），使用 `pnpm exec playwright install chromium` 安装后真实执行；就绪修复前为 3 passed / 2 failed。没有将这些失败计入通过结果。

## 独立 Compose production migration

使用现有 `compose.yaml`、Dockerfile 的 `api` 和 `migrator` target 从当前源码构建。完整命令与 finally 清理见 [production.sh](../../agent/log/fix-database-runtime/production.sh)。随机 project 为 `cce-scope-a-1792824812-12617`，使用独立端口、新 PostgreSQL/附件卷，`--env-file /dev/null`；未复用旧数据或重置既有卷。

| 检查                              |     退出码 | 结果                                                                                                         |
| --------------------------------- | ---------: | ------------------------------------------------------------------------------------------------------------ |
| `compose build api migrator`      |          0 | 当前源码镜像构建通过（含 `pnpm build:api`）                                                                  |
| 空库查询                          |          0 | public 为 **0 tables**                                                                                       |
| `compose run --rm migrator`       |          0 | 六项全部 applied                                                                                             |
| table/constraint/index 查询       |          0 | **28 tables、392 pg_constraint rows（含 NOT NULL）、63 indexes**；含 `users`、`api_tokens`、附件及上传暂存表 |
| 重启 PostgreSQL + 再运行 migrator |          0 | 六项全部 already_applied，无重复结构冲突                                                                     |
| `compose up -d --wait api`        |          0 | API 容器健康                                                                                                 |
| `/api/health`                     |          0 | HTTP 200，`{"status":"ok","database":"available"}`，处理器实际执行 PostgreSQL 查询                           |
| `/health`                         | 22（curl） | **HTTP 404**；当前注册路径是 `/api/health`，不能声称字面 `/health` 通过                                      |

证据：[空库](../../agent/log/fix-database-runtime/compose-empty.log)、[首次迁移](../../agent/log/fix-database-runtime/compose-migrate.log)、[实际 schema](../../agent/log/fix-database-runtime/compose-schema.log)、[重启后迁移](../../agent/log/fix-database-runtime/compose-remigrate.log)、[API 数据库健康](../../agent/log/fix-database-runtime/compose-api-health.log)、[清理](../../agent/log/fix-database-runtime/compose-cleanup.log)。结束后仅移除该 project 的两个卷、容器和网络。健康结果不代表完整业务验收通过。

## NEXT_SCOPE_BLOCKER — Thread C

1. **浏览器 SSE 取证**：`apps/vue/tests/persisted-journeys.spec.ts:33` 的 `await stream.body()` 报 `Protocol error (Network.getResponseBody): No data found for resource with given identifier`。此前 HTTP 200 和 `text/event-stream` 断言通过，失败发生在浏览器协议层读取响应体。测试在后续 extraction/review/commit/reload 前中断，不能据此宣称该业务链通过。Vue `chat-stream.ts` 收到 completed 后返回并在 finally 取消 reader，可能与 Chromium 响应体不可取有关，但本 Scope 尚未证明因果。交 Thread C 核查流结束生命周期和浏览器取证方式，保留所有事件、持久化及审批断言。
2. **健康路径契约**：若要求对外字面 `/health`，当前返回 404；需要 API/部署 Scope 决定是否提供别名或统一文档。数据库连接及现有 `/api/health` 已通过，本 Scope 不添加业务路由。

decoupling 使用同一组 5 个浏览器测试，本轮全部通过，包括 SSE、reviewed commit 和 reload；因此上述 standalone 失败属于间歇性问题，不能声称因果已确定或问题已修复。两次运行均保留原断言、零 retries，没有使用成功运行覆盖失败日志。最终 `docker ps` 无运行容器，隔离资源已清理。

最终条件：空库迁移、FK/schema 契约、runner、integration、decoupling 已通过；standalone 最近一次 4 pass / 1 fail，仍为 NEXT_SCOPE_BLOCKER。没有将启动成功、健康探针或部分测试通过写为整体验收 PASS。全仓 coverage/lint/前端 production build 本轮未重跑；本报告仅声明表中实际执行的检查结果。
