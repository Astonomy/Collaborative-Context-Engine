# Scope C — Full Runtime & Production Acceptance

验收日期：2026-10-24–27（Asia/Shanghai）。本报告仅使用本轮当前源码的执行结果；历史报告用于前置条件核查，不作为本轮镜像、dist 或业务通过证据。

**DECOUPLED: YES**。四个 Gate 全部通过；没有剩余签收 blocker。

| Gate            | 结论     | 最终证据                                                                                                                                 |
| --------------- | -------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| A. Architecture | **PASS** | Vue → standalone API；Plugin → standalone API；API → server-runtime/application/domain/adapters；source、bundle、生产镜像无 Next runtime |
| B. Runtime      | **PASS** | 真实 PostgreSQL integration 34/34；两组真实 Chromium E2E 各 5/5；认证、业务、媒体、SSE、MCP/Plugin 均通过                                |
| C. Production   | **PASS** | 当前源码新镜像；HTTPS/nginx 123 项检查；镜像替换前数据保留及 API/frontend/PostgreSQL 重启各 23 项检查通过                                |
| D. Quality      | **PASS** | lint/typecheck/build/format/verify:frontend/coverage/runtime audit 全部 exit 0，无阈值降低或断言跳过                                     |

## 前置条件与隔离边界

已读取 [Database Runtime 修复报告](fix-database-runtime.md) 和 [Quality Gate 修复报告](fix-quality-gate.md)：空库六项迁移、真实 PostgreSQL 连接、build/typecheck/lint/format 已通过。Scope A 留下的 standalone SSE 响应体取证失败不作为通过记录；本轮重新执行两组真实浏览器测试。

命令在 Ubuntu WSL2 `/mnt/d/code/Collaborative-Context-Engine` 执行，使用 Linux Node 24.22.0、pnpm 11.22.0。保留工作区原有未提交改动，不重构架构、不删除 Next、不修改 RBAC 或人工审批语义。命令记录器直接保存子命令退出码；证据目录为 [final-decoupling-20261024](../../agent/log/final-decoupling-20261024/)。

生产环境使用独立 Compose project `cce-scope-c-1792828379`，独立 PostgreSQL 和附件 volumes。API、frontend/nginx、migrator 使用 `build --no-cache`；PostgreSQL 使用仓库声明的 18.6 镜像。端口为 PostgreSQL 25484、API 23084、HTTP 28084、HTTPS 28444，均仅绑定 loopback。外部临时目录保存随机数据库密码、session secret、测试身份 token、TLS 私钥；未修改仓库 `.env`。

TLS override 在同一 frontend nginx 增加 443 入口，再转发到仓库原有 80 路由；`/api` 和 `/mcp` 仍由原 nginx 配置代理至 standalone API。Node/curl 使用本轮 CA；Chromium 对本地自签名证书允许访问。本地 TLS 验收不代表公网 DNS/CA 部署。

模型使用既有 `scripts/e2e-model-server.mjs` 的确定性 fixture，经正式 ModelProvider 和 HTTP 调用。生产 fixture 副本仅改为容器可达监听，并添加受控慢流用于取消测试；数据库、HTTP API、MCP、上传和持久化均为真实实现。测试内容为本轮合成证据与仓库媒体 fixture，不读取用户浏览器 DOM/cookies 或历史对话作为 Plugin 输入。

## 本轮首次执行（连接池修复前）

| 命令                                          | exit code | 结果                                          |
| --------------------------------------------- | --------: | --------------------------------------------- |
| `TEST_DATABASE_URL= pnpm test:integration`    |         0 | 3 files / 33 tests passed                     |
| `TEST_DATABASE_URL= pnpm test:e2e:standalone` |         0 | Chromium 5 passed，零 retries                 |
| `TEST_DATABASE_URL= pnpm test:e2e:decoupling` |         0 | Chromium 5 passed，零 retries                 |
| `pnpm typecheck`                              |         0 | 全仓通过                                      |
| `pnpm build`                                  |         0 | API 与 Vue 重新构建                           |
| `pnpm verify:frontend`                        |         0 | Next 0 / Vue 22 JS files                      |
| `pnpm test:coverage`                          |         0 | 根项目 531、Vue 142、Plugin 4 tests passed    |
| `node scripts/audit-runtime-dependencies.mjs` |         0 | 513 API imports / 128 Vue modules，无 Next 边 |

对应 `.command`、`.log`、`.exit` 位于本轮证据目录。浏览器测试使用真实 HTTP API 和隔离 PostgreSQL，包含登录、项目/会话、SSE、review/commit/reload、agents、PNG/JPEG/MP4 和权限隔离，没有使用 `--list` 代替执行。

## 构建期间的外部失败

首次 `compose build --no-cache api frontend migrator` 退出 1：Docker Hub nginx 基础镜像层下载被远端重置，未进入数据库启动。原始日志为 [images-build.log](../../agent/log/final-decoupling-20261024/images-build.log)。随后 `docker pull nginx:stable-alpine` 退出 0，取得同一 digest `sha256:47928bf67eb62a1863cb08d9ecb52d3e704304ba614eaee17884204677702951`，再次无缓存构建当前源码。没有使用历史应用镜像或旧 dist 代替。

## 本轮发现与最小修复

生产探针第一次在 117 项检查后失败：附件预览由 `IntersectionObserver` 懒加载，探针直接等待尚未创建的 `img`，未先滚动附件卡片。修正探针为先滚动 region，再验证图片实际解码和视频播放；没有移除断言或改变 UI。修正后完整探针 **123 checks / exit 0**，见 [production-final.log](../../agent/log/final-decoupling-20261024/production-final.log)。失败截图保留于本轮目录；原始 Playwright trace 包含登录输入，保存在仓库外隔离目录的 `production-failure.zip`，不把 token 写入仓库报告。

随后真实 PostgreSQL 受控重启暴露正式缺陷：服务端 SQLSTATE `57P01` 终止空闲连接，`pg.Pool` 发出未处理的 `error` 事件，Node API 退出，nginx 请求返回 **502**。API/frontend 各自重启的 23 项检查先前均通过，失败发生于数据库重启后首次读取项目。证据：[失败探针](../../agent/log/final-decoupling-20261024/persist-after-postgres-before-fix.log)、[脱敏容器日志](../../agent/log/final-decoupling-20261024/postgres-restart-full.log)。

修复仅在 `packages/database/src/connection.ts` 的正式 pool factory 注册 error listener。pg 自行移除失效的空闲连接，后续请求可新建连接；listener 输出固定诊断，不记录 error/client 对象和连接凭据。没有自动重放事务、修改权限、审批或 API 契约，也没有用 Compose 自动重启掩盖进程崩溃。

新增单元回归先复现异常（exit 1，10 passed / 1 failed），修复后 exit 0、11/11。新增真实 PostgreSQL integration 回归只终止测试自己建立的空闲 backend，验证 pool 移除该连接、使用不同 backend PID 重新读取同一已持久化项目；修复后完整 integration **34/34，exit 0**。见 [before](../../agent/log/final-decoupling-20261024/idle-pool-regression-before.log)、[after](../../agent/log/final-decoupling-20261024/idle-pool-regression-after.log)、[真实数据库回归](../../agent/log/final-decoupling-20261024/integration-pool-recovery.log)。修复后的镜像重建、123 项生产业务检查及三轮各 23 项重启持久化检查均已通过，修正测试取证后完整 Gate 再次全部通过。

## 最终 Gate 中发现的测试取证问题

连接池修复后的首次完整 Gate 中，lint/typecheck/build/frontend audit/integration/standalone E2E 均 exit 0；coverage、decoupling E2E 和报告 format 为 exit 1，未将这轮记为全通过。

- Coverage：`media-browser-boundary.test.ts` 全浏览器入口图的同步 TypeScript 转译耗时 5971ms，超过默认 5000ms，结果为 531 passed / 1 timed out，没有断言失败。仅该项 timeout 改为 30000ms，保留全部入口扫描、禁止依赖断言及回归用例；局部复跑 7/7。没有修改全局超时或覆盖率阈值。
- SSE：decoupling 为 4 passed / 1 failed，再次复现 `Network.getResponseBody: No data found`。Vue 按既有协议在 completed 后取消 reader，Chromium 可能丢弃被取消请求的响应体；没有页面跳转发生在失败调用之前。测试改为在浏览器消费前对真实 Fetch Response 使用 `clone().text()` 独立留存字节，保留原 HTTP 状态、Content-Type 和四种事件断言，以及后续 UI/审批/commit/Agent/reload 检查。没有拦截或模拟 HTTP API，也没有修改 Vue 的取消语义。真实 nginx abort/reader.cancel 与数据库 interrupted 终态仍由生产探针独立验证。
- Format：仅本轮报告 Markdown 表格需格式化，未改变扫描范围。

失败日志：[coverage](../../agent/log/final-decoupling-20261024/final-test-coverage.log)、[SSE](../../agent/log/final-decoupling-20261024/final-test-e2e-decoupling.log)、[format](../../agent/log/final-decoupling-20261024/final-format.log)。SSE 失败截图为 [decoupling-sse-failure.png](../../agent/log/final-decoupling-20261024/decoupling-sse-failure.png)，原始 trace 在仓库外隔离目录 `decoupling-before-sse-fix/` 保留，避免重复执行覆盖。

取证副本的初版在页面启动后安装，但 `ApiClient` 在构造时已保存原 fetch，导致副本变量未设置；两组测试各 4 passed / 1 failed（`acceptance-test-e2e-*.log`）。随后改为 `page.addInitScript` 在应用初始化前安装，并显式等待捕获发生，真实 decoupling 回归 5/5、exit 0，见 [sse-regression.log](../../agent/log/final-decoupling-20261024/sse-regression.log)。该轮失败 trace 也保存在仓库外 `s14-standalone-capture-timing/`、`s14-decoupling-capture-timing/`。

最后一轮全量命令由 [release-gates.sh](../../agent/log/final-decoupling-20261024/release-gates.sh) 执行，以 `release-*` 命名日志；所有失败轮次仍保留。前一轮正在等待的 lint 已中止，以重新检查固定后的完整源码，不把中止记为通过。最后两处改动只影响测试取证与执行时间预算，生产镜像中的正式代码与已通过的重启验收一致。

2026-10-25 恢复同一隔离 project 后，额外执行原数据重读与浏览器检查，仍为 23/23、exit 0，见 [acceptance-persistence.log](../../agent/log/final-decoupling-20261024/acceptance-persistence.log)；环境状态见 [final-environment.log](../../agent/log/final-decoupling-20261024/final-environment.log)。没有重新初始化 volume。

2026-10-25 的 `release-*` 全量运行中，九项命令 exit 0，仅 lint exit 1：测试探针保存 `window.fetch` 触发 `@typescript-eslint/unbound-method`。2026-10-27 将该方法显式绑定为 `window.fetch.bind(window)`，保留真实网络调用和全部断言，并先单独验证变更文件 lint。最终全量签收命令由 `signoff-gates.sh` 执行，使用 `signoff-*` 日志；`release-lint.log` 的失败原文保留。

## 生产成功路径的验收内容

身份通过已有 `seedDevelopmentIdentity(PostgresUnitOfWork)` 正式 provisioning 创建，三名隔离用户分别作为 owner、viewer、outsider。token 由安全随机数生成，仅保存于仓库外 600 权限文件并传入请求，数据库保存哈希。没有手工伪造 RBAC、修改 API 或把无效 token 的 401 当作登录成功。

| 检查          | 预期与已执行验证                                                                                                                                               |
| ------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 空库迁移      | public 初始 0 tables；0001–0006 全部 applied；`api_tokens` 可查询                                                                                              |
| Session       | 无效 token 401；合法 token 登录 200；真实 cookie 往返 200；Secure / HttpOnly / SameSite=Strict；登出清除 cookie 后 401                                         |
| 过期与 RBAC   | 仅对负向测试用现有 codec 生成已过期 cookie，返回 401；viewer 创建会话 403；outsider 读取项目 404                                                               |
| 真实业务      | Project → Conversation → Message → extraction delta → merge request → owner resolution → semantic commit → context reload                                      |
| 审批与并发    | 未审批 finalize 409；错误 expectedHeadCommitId 409；同 Idempotency-Key 重放返回完全相同 commit；clientMessageId 重放不重复写消息                               |
| Provenance    | commit change 的 afterVersion 保留 project、conversation、原 message ID；提交者为正式身份；integration 验证 commit 不可变性                                    |
| Agent         | 创建 201、读取 200、最终 completed；integration 另验证人工审批、取消及依赖失败                                                                                 |
| 媒体          | PNG/JPEG/MP4 上传 201；Conversation 与 Message 的 attachments[] 关联；授权读取 200；完整字节与文件逐字节相等                                                   |
| Range         | 授权 206、正确 Content-Type / Content-Range / 部分字节；越界 416 和 `bytes */size`；跨项目身份下载 404                                                         |
| SSE           | nginx 返回 HTTP 200、`text/event-stream`；user_persisted、assistant_started、text_delta、completed 实际事件；abort 与 reader.cancel 后真实 DB 状态 interrupted |
| MCP           | 标准 SDK initialize、listTools、preview、submit；幂等重放；真实 Conversation/Message 重读；无效 token 401、跨项目 preview 拒绝                                 |
| Submit Plugin | 正式上传 helper 读取临时二进制 PNG，返回真实 attachmentId，MCP submit 后消息 attachments[] 绑定；不是文件名文本替代附件                                        |
| Browser       | Chromium 登录、cookie、Vue 重载消息和 canonical context、PNG/JPEG 解码与 MP4 播放、登出；所有请求不含 :3000 / Next / legacy                                    |

生产探针为 [acceptance.mjs](../../agent/log/final-decoupling-20261024/acceptance.mjs)，执行入口为 [check-production.sh](../../agent/log/final-decoupling-20261024/check-production.sh)。所有成功业务请求都通过 `https://localhost:28444` 的同一 nginx；数据库校验使用真实 `SELECT`。integration 和两组既有 Playwright 测试另覆盖通过 UI 完成 proposal/review/commit、Agent 和媒体上传，而非只有 API 探针。

会话保留既有无状态语义：登出删除浏览器 cookie，不撤销底层 token；integration 验证旧 cookie 在 token 未撤销时仍可用，撤销 token 后不可用。本轮没有更改该语义，也没有声称实现服务器端 session revocation。

## 复现入口与保留数据

本轮脚本均位于证据目录，`compose.sh` 固定读取该目录记录的外部 env 和 Compose override，所有操作限于该 project。`run.sh` 为每个子命令记录 `.command`、`.log`、`.exit`。修复后流程由 `rebuild-pool-fix.sh` 执行：源码无缓存构建、替换本轮 API/frontend 容器、读取修复前已保存数据、完整业务探针、API/frontend/PostgreSQL 逐项重启及再次读取。

`restarts.sh` 每轮重启均等待服务恢复，再执行同一批 23 项持久化/浏览器检查，读取同一 Project、Message、Commit 和三种附件原始字节。没有删除数据库、重置 volume 或重新 seed 数据来替代重启持久化。测试状态与 provenance 保存在 [state.json](../../agent/log/final-decoupling-20261024/state.json)。该文件不含 token。

## 修复后 Production 结果

| 实际命令（`C` 表示 `bash agent/log/final-decoupling-20261024/compose.sh`）       | exit code | 结果 / 日志                                                                                                                                       |
| -------------------------------------------------------------------------------- | --------: | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| `C build --no-cache api frontend migrator`                                       |         0 | [当前源码重建](../../agent/log/final-decoupling-20261024/images-build-pool-fix.log)                                                               |
| `C up -d --no-build --wait api frontend model`                                   |         0 | [新镜像启动](../../agent/log/final-decoupling-20261024/services-pool-fix.log)                                                                     |
| `check-production.sh persisted-after-image-fix verify`                           |         0 | 修复前已写入的真实数据，23/23；[日志](../../agent/log/final-decoupling-20261024/persisted-after-image-fix.log)                                    |
| `check-production.sh production-pool-fix`                                        |         0 | 完整业务 123/123；[HTTP/SDK/浏览器日志](../../agent/log/final-decoupling-20261024/production-pool-fix.log)                                        |
| `C restart api` + `C up -d --no-build --wait api` + persistence verify           | 0 / 0 / 0 | 23/23；[日志](../../agent/log/final-decoupling-20261024/persist-after-api.log)                                                                    |
| `C restart frontend` + `C up -d --no-build --wait frontend` + persistence verify | 0 / 0 / 0 | 23/23；[日志](../../agent/log/final-decoupling-20261024/persist-after-frontend.log)                                                               |
| `C restart postgres` + `C up -d --no-build --wait postgres` + persistence verify | 0 / 0 / 0 | 23/23；API 无需再次重启；[日志](../../agent/log/final-decoupling-20261024/persist-after-postgres.log)                                             |
| `C run --rm migrator`                                                            |         0 | 六项 already_applied；[日志](../../agent/log/final-decoupling-20261024/remigration.log)                                                           |
| `C exec -T frontend nginx -t`                                                    |         0 | [配置验证](../../agent/log/final-decoupling-20261024/nginx-config.log)                                                                            |
| `audit-production.sh`                                                            |         0 | next/react/react-dom/@cce/web 均不可解析，API user=node；[镜像及挂载](../../agent/log/final-decoupling-20261024/production-image-audit-final.log) |

最后一次 PostgreSQL 重启只产生固定的 idle connection 诊断，没有未处理 error/进程退出；见 [服务日志](../../agent/log/final-decoupling-20261024/services-final.log)。生产浏览器网络路径单独保存在 [network](../../agent/log/final-decoupling-20261024/production-browser-network.log)，不含认证头和 token。

| 最终 image      | ID                                                                        |
| --------------- | ------------------------------------------------------------------------- |
| API             | `sha256:f24a2bdc35e5c48bbb833e0737160f1f6fb9d5e1db4abb6432461a1b7619dd41` |
| frontend        | `sha256:f1ef4be04f1364a3773f1c094693282c486005bcf08a6e46581cab2c07ce7af7` |
| migrator        | `sha256:f64495ae640d363672da4c6e8a80a57a435c08304f7e2c9ca1df26230f09cc0a` |
| PostgreSQL 18.6 | `sha256:b07129cc272f688c98f5b343138a0a52fa45b3d82f50d7a53ff441330624cd2e` |

最终应用镜像创建于 2026-10-24 23:22–23:24（Asia/Shanghai）。PostgreSQL/Node 为官方基础镜像，不含本项目历史应用产物。项目卷 `cce-scope-c-1792828379_cce-postgres` 与 `cce-scope-c-1792828379_cce-attachments` 均保留，未操作其他项目的卷。

## 最终完整 Gate（2026-10-27）

| 实际命令                                      | exit code | 数量 / 结果                                                      | 原始日志                                                                         |
| --------------------------------------------- | --------: | ---------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| `pnpm lint`                                   |         0 | 全仓 ESLint，无错误/警告                                         | [log](../../agent/log/final-decoupling-20261024/signoff-lint.log)                |
| `pnpm typecheck`                              |         0 | 全仓类型检查                                                     | [log](../../agent/log/final-decoupling-20261024/signoff-typecheck.log)           |
| `pnpm build`                                  |         0 | API 与 Vue 当前源码重新构建                                      | [log](../../agent/log/final-decoupling-20261024/signoff-build.log)               |
| `pnpm verify:frontend`                        |         0 | Vue 22 JS assets，Next 0                                         | [log](../../agent/log/final-decoupling-20261024/signoff-verify-frontend.log)     |
| `pnpm test:coverage`                          |         0 | 根项目 532、Vue 142、Plugin 4 tests passed；原覆盖率门槛全部满足 | [log](../../agent/log/final-decoupling-20261024/signoff-test-coverage.log)       |
| `TEST_DATABASE_URL= pnpm test:integration`    |         0 | 3 files / 34 passed                                              | [log](../../agent/log/final-decoupling-20261024/signoff-test-integration.log)    |
| `TEST_DATABASE_URL= pnpm test:e2e:standalone` |         0 | Chromium 5 passed / 0 failed / 0 retries                         | [log](../../agent/log/final-decoupling-20261024/signoff-test-e2e-standalone.log) |
| `TEST_DATABASE_URL= pnpm test:e2e:decoupling` |         0 | Chromium 5 passed / 0 failed / 0 retries                         | [log](../../agent/log/final-decoupling-20261024/signoff-test-e2e-decoupling.log) |
| `node scripts/audit-runtime-dependencies.mjs` |         0 | 513 API imports / 128 Vue modules / 0 Next edges                 | [log](../../agent/log/final-decoupling-20261024/signoff-runtime-audit.log)       |
| `pnpm format:check`                           |         0 | 全仓格式通过                                                     | [log](../../agent/log/final-decoupling-20261024/signoff-format.log)              |

最终两组浏览器测试均完整执行，非 `--list`、非 retries；SSE 四种事件、UI 提案/审批/commit、Agent completed 与上下文重载断言均保留。最终生产代码唯一变更为数据库 pool 空闲连接错误处理；其余为回归/验收取证及相关文档。Next.js legacy 文件与依赖仍保留，但不进入实际运行依赖图。

Windows 与 WSL 均无 :3000 listener，见 [Windows](../../agent/log/final-decoupling-20261024/windows-no-next-final.txt)、[WSL](../../agent/log/final-decoupling-20261024/no-next-production.log)。没有使用 2026-10-16 的旧应用镜像或 dist，没有删除真实业务数据或其他项目的卷。

本轮签收的是上述本地隔离生产拓扑与确定性 ModelProvider fixture，公网域名/CA 和外部模型服务 SLA 不在此次验证范围。已有无状态登出语义保留；这些不是尚未执行的本轮检查项。最终结论：**DECOUPLED: YES**。
