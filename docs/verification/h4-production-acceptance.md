# H4 production acceptance

执行日期：2026-10-16（Asia/Shanghai）。结论：**未通过，真实空库 migration 阻塞业务验收**。本轮实际构建并运行 Docker/nginx/PostgreSQL，未用 Compose 配置检查或 healthcheck 代替业务验收。未修改生产代码、迁移、测试断言或已有用户改动。

## 环境、隔离与执行方式

- Windows 工作区 `D:\code\Collaborative-Context-Engine`，通过 Ubuntu WSL 执行 Docker Engine 29.7.2、Compose v5.5.0；Windows 本身无 Docker CLI。
- 独立 project：`cce-h4-20261016`。独立 loopback 端口：frontend HTTP `58084`、HTTPS `58444`、API `53014`、PostgreSQL `55444`。
- 外部安全 env：WSL `/home/ssh/.local/share/cce-h4-20261016/acceptance.env`，目录权限 700、env 权限 600，随机数据库密码及 session secret；未读取仓库 `.env` 作为本轮配置，未把凭据写入报告或日志。见 [权限记录](../../agent/log/h4-logs/env-permissions.txt)。
- 独立 volumes：`cce-h4-20261016_cce-postgres`、`cce-h4-20261016_cce-attachments`。已有容器见 [执行前清单](../../agent/log/h4-logs/before-containers.txt)，未启动、删除或修改其数据库 volume。
- HTTPS 使用本轮自签名证书，存于外部目录。验收 override 为同一 frontend nginx 增加 `443 → 127.0.0.1:80` 的 TLS 入口，之后经过仓库原有 `/api`、`/mcp`、静态资源路由。没有替换原生产路由；API 设置 `CCE_API_PUBLIC_ORIGIN=https://localhost:58444`。见 [TLS override](../../agent/log/h4-logs/compose-tls.yaml)、[TLS nginx 配置](../../agent/log/h4-logs/tls.conf)。这是本地 TLS 验收，不证明公网证书、DNS 或外部 ingress 配置。
- 初次使用 `/tmp` 存放外部配置，WSL 会话结束后服务收到 shutdown 且临时文件被清理，第一次 HTTP 脚本退出 2、未发出请求。随后保持 WSL 会话，将同一隔离容器配置恢复到上述持久目录、重新生成临时证书，仅重建 frontend 容器以更新证书挂载。后续所有 HTTP、浏览器、重启测试均在恢复后执行。没有把这次基础设施失败计作通过。

核心命令如下，均在仓库根目录、WSL 中执行。完整 stdout/stderr 见日志；`--no-build` 保证启动时使用本轮刚构建的镜像。

```sh
docker compose -p cce-h4-20261016 --env-file <external-env> build --no-cache api frontend migrator
docker compose -p cce-h4-20261016 --env-file <external-env> up -d --wait postgres
docker compose -p cce-h4-20261016 --env-file <external-env> -f compose.yaml -f <external-tls-override> run --rm --no-deps migrator
docker compose -p cce-h4-20261016 --env-file <external-env> -f compose.yaml -f <external-tls-override> up -d --no-build --wait api frontend
```

## 镜像和运行容器

API、frontend、migrator 均来自当前恢复工作区的 `--no-cache` 构建，构建退出 **0**。没有复用旧应用 image；基础镜像按 Dockerfile 正常解析。frontend 构建时间 15:27:15，API/migrator 15:27:58。见 [完整构建日志](../../agent/log/h4-logs/build.log)、[image ID](../../agent/log/h4-logs/images.txt)。

| Image      | 实际 ID                                                                   |
| ---------- | ------------------------------------------------------------------------- |
| API        | `sha256:5175ae9d8c5ed3db0ef6d199d4125756f06198fb286b0773a10f3d966e3d9de2` |
| frontend   | `sha256:126defa9b35147a25be170c5ed7636be81dc53dfce5dcc3d125dcab6549dc20b` |
| migrator   | `sha256:70d0764c0c6c42562408a183e43183dc8a4ef53204786b2e5cd5314ef69bca15` |
| PostgreSQL | `sha256:b07129cc272f688c98f5b343138a0a52fa45b3d82f50d7a53ff441330624cd2e` |

| Container                    | ID 前缀        | 验收及显式重启后的状态 |
| ---------------------------- | -------------- | ---------------------- |
| `cce-h4-20261016-api-1`      | `b4993f8fc5f9` | running / healthy      |
| `cce-h4-20261016-frontend-1` | `799013bb0949` | running / healthy      |
| `cce-h4-20261016-postgres-1` | `5b0cc9afec6b` | running / healthy      |

完整容器 ID、运行镜像和 mounts 见 [inspect](../../agent/log/h4-logs/container-inspect.txt)，端口及服务清单见 [Compose ps](../../agent/log/h4-logs/containers.txt)。migrator 是 `run --rm` 一次性任务，实际退出 1 后移除。nginx 实际版本为 1.30.6；`nginx -t` 退出 0，见 [结果](../../agent/log/h4-logs/nginx-test.txt)。

## 真实迁移失败及业务影响

真实 PostgreSQL 18.6 空库执行 migrator，退出 **1**，服务端报错：

```text
column "id" referenced in foreign key constraint does not exist
CREATE TABLE import_attachment_uploads (
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE RESTRICT,
  ...
);
```

来源：`packages/database/migrations/0006_import_attachment_uploads.sql:2`；初始迁移定义的是 `projects.project_id`。与 H3 发现一致。见 [migrator 输出](../../agent/log/h4-logs/migration.log)、[PostgreSQL 错误和实际 SQL](../../agent/log/h4-logs/postgres.log)。迁移事务回滚，查询 public schema 得到 **0 tables**，见 [数据库查询](../../agent/log/h4-logs/schema.txt)。没有手工补表、兼容列、跳过 0006 或改 migration ledger。

迁移失败后，为检查独立进程、nginx 路由及失败行为，仍启动 API/frontend；这不代表可发布。API `/api/health` 仅执行 `select 1`，因此 **200/healthy 与 schema 不存在同时发生**。登录 POST 实际返回 500，API 日志明确记录 SQLSTATE `42P01`、`relation "api_tokens" does not exist`，见 [API 日志](../../agent/log/h4-logs/api.log)。

## HTTP、HTTPS 与浏览器结果

全部 HTTPS curl 使用 `--cacert <本轮证书>` 验证证书，没有使用 `-k`。每个请求保存 headers/body，并记录 HTTP 状态及 curl 退出码；下列有效请求的 curl 退出码均为 **0**，表示传输完成，不表示业务成功。见 [首次 HTTP 记录](../../agent/log/h4-logs/http.txt)、[重启后 HTTP 记录](../../agent/log/h4-logs/http-after-restart.txt)、[探针命令](../../agent/log/h4-logs/probes.sh)。

| 实际请求                                           | HTTP | 判定                                                         |
| -------------------------------------------------- | ---: | ------------------------------------------------------------ |
| `GET /`                                            |  200 | Vue HTML、`#app`、真实模块 JS 引用                           |
| `GET /projects/h4-deep-link`                       |  200 | 与首页字节相同，SPA fallback 通过                            |
| `GET /assets/index-BSBodv6p.js`                    |  200 | 197072 bytes，JavaScript，immutable cache                    |
| `GET /assets/h4-missing.js`                        |  404 | 缺失静态资源不 fallback                                      |
| `GET /api/health`                                  |  200 | nginx → standalone API → PostgreSQL 可达；不证明 schema 完整 |
| `GET /api/h4-missing`                              |  404 | 空响应，未返回 Vue HTML                                      |
| `GET /api/session` 无凭据                          |  401 | API 认证错误 JSON                                            |
| `POST /api/session`，同源、测试 token              |  500 | 认证查询因缺表失败，登录/session 未通过                      |
| `DELETE /api/session`，同源                        |  200 | 清除 cookie 含 HttpOnly、Secure、SameSite=strict、Max-Age=0  |
| `POST /mcp` initialize，无凭据                     |  401 | nginx `/mcp` 已到认证边界，非 SPA                            |
| POST conversation attachment，无凭据               |  401 | 仅验证拒绝匿名上传，不证明二进制上传成功                     |
| GET attachment content，无凭据                     |  401 | 仅验证匿名下载被拒绝                                         |
| GET attachment content，`Range: bytes=0-7`，无凭据 |  401 | 没有 206/video Range 成功证据                                |
| POST chat，`Accept: text/event-stream`，无凭据     |  401 | 没有实际 SSE 事件或增量到达证据                              |

上传、下载、Range、chat 使用合规格式的测试 UUID 定位路由；并不存在已创建的业务对象。401 不能替代 RBAC 跨项目校验、授权成功下载或媒体处理验收。HTTPS cookie 清除头通过，不等于成功登录、cookie 存储/回传或 session 恢复通过。

真实 Chromium/Playwright 访问 `https://localhost:58444/`，Vue 成功挂载并显示 Sign in/API token 表单；请求仅涉及该 HTTPS origin 的 HTML、JS、CSS 和 `/api/session`，没有 `:3000` 请求。见 [浏览器结果](../../agent/log/h4-logs/browser.txt)、[脚本](../../agent/log/h4-logs/browser.mjs)。浏览器为本地自签名证书启用了 `ignoreHTTPSErrors`；证书信任校验由上述 curl 独立完成。没有执行成功登录后的页面流程。

## MCP、Plugin、SSE、持久化和 Next 隔离

- **实际 MCP SDK**：使用仓库安装的 `@modelcontextprotocol/sdk`，`StreamableHTTPClientTransport` 直连 standalone API `http://127.0.0.1:53014/mcp`，携带专用无效测试 token。initialize 实际收到 500，未完成握手或 tools/list/tools/call；缺表时无法建立合法持久身份。匿名 nginx MCP 请求的 401 只能证明路由。
- **实际 Plugin helper**：调用仓库 `cce-upload-attachments.mjs` 的真实 `uploadAttachments`，读取临时 1×1 PNG 并向 standalone API 的 imports/attachments 发出真实上传请求，得到 500、没有提交 conversation。脚本退出 **1**。没有使用当前对话或用户文件。见 [实际调用结果](../../agent/log/h4-logs/mcp-plugin.txt)、[调用脚本](../../agent/log/h4-logs/mcp-plugin.mjs)。这不是成功的 Plugin 端到端验收。
- **SSE**：nginx 配置中的 buffering off 得以保留，但本轮实际 chat 请求在认证阶段返回 401，未产生模型调用、event-stream 或逐事件时间证据；判定阻塞，不把配置检查当作 SSE 通过。外部 ModelProvider 未验证。
- **重启**：实际 `compose restart api frontend` 退出 0，随后 `up --no-build --wait` 退出 0，重复全部 14 个 HTTP 探针，结果与重启前一致。见 [重启日志](../../agent/log/h4-logs/restart.txt)。独立数据库和附件 volume 挂载保持；由于 schema 回滚、无法创建业务记录，**业务数据及附件持久化未验证**。空库仍存在不能替代数据持久化通过。
- **API image 不依赖 Next.js**：容器以 uid 1000 `node` 运行，PID 1 为 `node --import tsx dist/apps/api/main.js`。实际文件树中无 next/react/react-dom/.next 安装目录、无 `apps/web`；容器内模块解析 next/react/react-dom/@cce/web 均失败，检查退出 0。见 [image 审计](../../agent/log/h4-logs/image-audit.txt)、[实际进程](../../agent/log/h4-logs/api-processes.txt)。构建阶段下载过 Next 并不意味着运行镜像包含 Next，本结论基于最终镜像检查。
- **关闭 Next 后的核心测试**：本轮开始、请求和重启阶段都没有运行 Next 容器或 `:3000` listener；已有历史 Next 容器保持 Exited，没有启动后再关闭的必要。WSL listener/容器见 [清单](../../agent/log/h4-logs/no-next.txt)，Windows `:3000` 查询无结果见 [记录](../../agent/log/h4-logs/windows-next-port.txt)。重复 HTTP、浏览器、MCP/Plugin 调用均在 Next 不运行时完成；这证明已执行部分无需 Next，不能推导被迁移阻塞的业务流程也已通过。

## 命令退出码与覆盖结论

原始顺序见 [exit-codes.txt](../../agent/log/h4-logs/exit-codes.txt)。早期日志收集遇到 Docker inspect 可选字段模板错误和 Windows 换行导致的 shell 重定向错误，后续已修正并重新采集；未据失败采集判定服务失败或成功。`http_probe_script_exit=2` 是上述外部临时目录丢失。

| 命令/检查                                        | 退出码 | 结果含义                                                                                 |
| ------------------------------------------------ | -----: | ---------------------------------------------------------------------------------------- |
| `compose build --no-cache api frontend migrator` |      0 | 新应用镜像构建完成                                                                       |
| `compose up -d --wait postgres`                  |      0 | 实际数据库启动；见 postgres-start.log                                                    |
| `compose run --rm --no-deps migrator`            |      1 | 空库迁移失败                                                                             |
| `compose up -d --no-build --wait api frontend`   |      0 | 三个服务 healthy，不代表业务通过                                                         |
| 恢复外部配置后的 `up --wait`                     |      0 | 后续有效请求的运行环境                                                                   |
| HTTP 探针脚本，重启前/后                         |  0 / 0 | curl 均完成；包含预期记录的 401/500                                                      |
| `compose restart api frontend` / 随后 wait       |  0 / 0 | 真实重启完成                                                                             |
| 容器镜像审计 / 禁止模块解析检查                  |  0 / 0 | 最终 API 镜像无 Next 依赖证据                                                            |
| MCP SDK + Plugin helper 脚本                     |      1 | 实际调用失败，业务验收未通过                                                             |
| Chromium Vue 挂载检查                            |      0 | 登录页挂载、无 :3000 请求                                                                |
| `nginx -t` / 完整 container inspect              |  0 / 0 | 配置和状态采集成功                                                                       |
| 证据一致性检查                                   |      0 | 两轮各 14 个 HTTP 状态、cookie 清除标志、fallback 和空 schema 与报告一致，不代表业务成功 |

证据一致性输出见 [evidence-check.txt](../../agent/log/h4-logs/evidence-check.txt)。本轮只增加验收文档和证据，没有修改实现，因此未重跑与本轮无关的全库 lint/unit/coverage；容器实际编译包含 API TypeScript 和 Vue typecheck/build，不能替代未通过的运行验收。

任务 1–6 的新镜像和服务启动已执行，任务 4 失败；任务 7 的 nginx 路由/静态行为通过；任务 8 仅 TLS 和 cookie 清除标志通过；任务 9–12 的成功业务路径阻塞；任务 13 的最终镜像审计通过；任务 14 在 Next 不运行时重复了当前可执行核心检查。**不能签收 CCE 生产部署。**

后续必须先解决 0006 外键目标错误，再用新构建镜像和全新隔离数据库重跑：成功登录及 session 往返、RBAC、二进制上传/授权下载/video 206 Range、实际 SSE、MCP initialize/tools/call、Plugin preview/submit 及 API/frontend 重启后的业务数据和附件读取。本轮未绕过迁移制造成功证据。

## 验收结束状态

证据采集后仅对本轮 project 执行 `compose stop api frontend postgres`，命令退出 0，三个容器最终均为 **Exited (0)**。前文 running/healthy 是实际验收时及重启后的状态。见 [停止日志](../../agent/log/h4-logs/stop.txt)、[最终容器状态](../../agent/log/h4-logs/final-containers.txt)。

没有执行 `down -v` 或 volume 删除；本轮两个 volume 均保留，见 [保留清单](../../agent/log/h4-logs/preserved-volumes.txt)。外部安全 env 和临时证书保留在 WSL 持久目录，便于复核。初次的 PostgreSQL 启动退出 0 由工具调用及 [postgres-start.log](../../agent/log/h4-logs/postgres-start.log) 确认；因 build 和数据库启动并行写记录，稍后 build 完成时覆盖了早期 exit-codes 文件，该项应以上述实际启动日志为准。
