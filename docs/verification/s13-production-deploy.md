# S13 生产部署验证

验证日期：2026-10-15（Asia/Shanghai）。结论：**ENVIRONMENT_BLOCKED，未完成生产部署验收**。

本报告只记录本次工作区执行结果。既有 `vue-api-deployment.md` 的历史成功记录不作为本次证据。未修改业务逻辑、Vue 页面、MCP/plugin 协议或 S10 数据库初始化脚本；未恢复或覆盖用户已有改动。

## 真实执行结果

| 检查                        | 本次结果                                                                                                                                              |
| --------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| Windows `docker version`    | 命令不存在                                                                                                                                            |
| WSL Ubuntu `docker version` | 成功，客户端及服务端 Docker Engine 29.7.2，API 1.55                                                                                                   |
| Node / pnpm                 | Windows Node v24.15.0 / pnpm 11.22.0                                                                                                                  |
| API image build             | 已实际执行；基础 Node image 元数据解析成功；构建上下文传输 154.9 秒、659.28 kB 后主动取消，退出码 1，`Canceled: context canceled`；未生成本次成功产物 |
| frontend image build        | 已实际执行；nginx image 拉取成功；构建上下文传输 135.5 秒、673.91 kB 后主动取消，退出码 1，同上                                                       |
| Compose 配置                | `docker compose --env-file /dev/null -p cce-s13-verify config --services` 成功，输出 postgres、api、frontend                                          |
| 容器启动 / migrator         | 未执行：缺少本次可构建的完整源码，未使用历史 image 替代                                                                                               |
| Vitest                      | 已有根及 Vue 配置、依赖、test/coverage 命令；实际 `pnpm exec vitest run` 退出码 1，未进入测试执行                                                     |

两个 build 均在 WSL `/mnt/d/code/Collaborative-Context-Engine` 执行原始命令：

```sh
docker build --target api -t cce-api:verify .
docker build --target frontend -t cce-frontend:verify .
```

取消原因是已经确认输入工作区不完整，继续等待上下文读取不能解决输入缺失；并非编译阶段失败，也不是部署成功。

## 已确认阻塞及处理

- `apps/api` 目录为空，没有 `package.json`、入口或构建配置；多个 `packages/*` 目录也为空。`git ls-files --deleted apps/api packages` 返回 141 个已跟踪删除项；API 等尚未跟踪的历史文件是否应存在，不能由 Git 删除列表推定。
- pnpm 只识别根、`@cce/vue`、`@cce/web` 三个 workspace，报 `ERR_PNPM_WORKSPACE_PKG_NOT_FOUND`：根引用的 `@cce/agents@workspace:*` 不存在。`node_modules/vitest/vitest.mjs` 也不存在。Vitest 配置已经启用，但目前无法安装/运行，不能声称测试通过。
- Dockerfile 的 `pnpm build:api` 和 `pnpm --filter @cce/api deploy --legacy --prod` 缺少必要输入；不在此部署 Scope 内重建应用包或恢复用户删除。
- Windows Docker 命令缺失已通过使用真实 WSL Docker 解决；其他问题未修复，未添加替代实现。

## 配置检查（静态证据，不代表运行通过）

检查文件：`Dockerfile`、`compose.yaml`、`deployment/nginx.conf`、`.dockerignore`、`.env.example`、`scripts/frontend.mjs`、根及 Vue 的 package/Vitest 配置、`docs/deployment.md`。

| 项目                               | 配置中的行为                                                                                        | 本次运行状态                                                                 |
| ---------------------------------- | --------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| `/`                                | nginx 静态根 `/usr/share/nginx/html`，SPA fallback 到 index.html                                    | 未验证                                                                       |
| `/api`、`/api/*`、`/mcp`、`/mcp/*` | 独立正则 location，`proxy_pass $api$request_uri` 保留路径，不经过 SPA fallback                      | 未验证真实路由；API 源码缺失，无法核对端点列表                               |
| 静态资源缺失                       | `/assets/` 使用 `try_files $uri =404`                                                               | 未验证                                                                       |
| API 依赖                           | 最终 Node stage 仅复制 `@cce/api` 的 production deploy artifact；未复制 Next build                  | 未取得新 image，不能确认内部无 Next/React，也无法验证完整依赖图              |
| Next.js                            | Compose 无 Next 服务，默认 root build 为 API + Vue                                                  | 未执行停机实验                                                               |
| frontend healthcheck               | wget `/frontend-health`，只检查静态服务                                                             | 未执行                                                                       |
| API healthcheck                    | Node fetch `/api/health`，非 2xx 失败                                                               | 未执行数据库可用/不可用路径                                                  |
| PostgreSQL healthcheck             | `pg_isready`                                                                                        | 未执行                                                                       |
| session / HTTPS                    | Compose 注入 session secret、public origin；nginx 仅监听 HTTP，依赖外层 TLS ingress                 | 未部署 TLS；Secure、SameSite、HttpOnly、Origin 校验均未实测                  |
| Authorization / RBAC               | nginx 未配置覆盖 Authorization；默认代理行为仍需真实 bearer 请求确认                                | 未验证有效/无效 token、跨项目拒绝及 Cookie 行为                              |
| Vue secrets                        | Docker ignore 排除真实 env；frontend build 参数只有公开 VITE 配置；frontend 脚本不加载根服务端 env  | 无本次 bundle，未做产物秘密扫描                                              |
| SSE / upload streaming             | response/request buffering 均 off；HTTP/1.1；read timeout 300s                                      | SSE 首事件、连续事件、断连取消、超时未验证                                   |
| 媒体                               | 走上述 API 代理；未在 nginx 仿造媒体端点                                                            | image、video Range 206/416、Content-Type、原始字节、文件流和鉴权下载均未验证 |
| 持久化                             | PostgreSQL mount `/var/lib/postgresql`；附件 mount `/var/lib/cce/attachments`；API 以 node 用户运行 | volume 权限、写入、重启后数据库及附件存续均未验证                            |

Compose 默认数据库密码 `cce` 仅适合开发；生产须注入独立密码、session secret 和 HTTPS public origin。缺少 public TLS ingress 配置，不能把 loopback HTTP 测试视为 HTTPS 验收。

## 隔离复现步骤

先恢复完整且由用户确认的当前迁移工作区，再运行以下命令。所有 Compose 命令必须保持同一 `--env-file` 和 `-p`；不得操作既有默认项目或共享 volume。以下过程不删除任何 volume。

在 WSL 仓库目录创建仓库外私有 env 文件（不要提交），设置独立随机 `POSTGRES_PASSWORD`、至少 32 随机字节的 `CCE_SESSION_SECRET`、可用外部 model 配置、`CCE_API_PUBLIC_ORIGIN=https://<测试域名>`，并设置未占用的 `FRONTEND_PORT=55440`、`CCE_API_PORT=55441`、`POSTGRES_PORT=55439`。为该测试域名配置真实 TLS ingress，转发至 frontend。

```sh
pnpm install --frozen-lockfile
pnpm test
pnpm test:coverage
docker build --target api -t cce-api:verify .
docker build --target frontend -t cce-frontend:verify .
docker run --rm --entrypoint sh cce-api:verify -c 'find /workspace/node_modules -type d \( -name next -o -name react -o -name react-dom \) -print'
docker compose --env-file /tmp/cce-s13-verify.env -p cce-s13-verify up -d --wait postgres
docker compose --env-file /tmp/cce-s13-verify.env -p cce-s13-verify --profile tools run --build --rm migrator
docker compose --env-file /tmp/cce-s13-verify.env -p cce-s13-verify up -d --build --wait frontend api
docker compose --env-file /tmp/cce-s13-verify.env -p cce-s13-verify ps
curl -i http://127.0.0.1:55440/
curl -i http://127.0.0.1:55440/frontend-health
curl -i http://127.0.0.1:55440/api/health
curl -i http://127.0.0.1:55440/api/nonexistent
curl -i http://127.0.0.1:55440/mcp
curl -i http://127.0.0.1:55440/assets/nonexistent.js
docker compose --env-file /tmp/cce-s13-verify.env -p cce-s13-verify restart frontend
docker compose --env-file /tmp/cce-s13-verify.env -p cce-s13-verify restart api
```

image 目录扫描仅是初筛；还须检查 production manifest/完整传递依赖及实际入口启动。Compose 会构建相同 target，但不会自动使用上面 `:verify` 标签；须记录实际容器 image ID。

恢复后按真实 API 路由创建隔离用户、不同项目身份与媒体样本，记录 HTTPS 登录 Set-Cookie、Origin 拒绝、bearer 和 RBAC；用 `curl -N` 验证真实 SSE 首包、断连及超时。上传后记录数据库标识及附件 hash，分别重启 frontend/API/PostgreSQL，重新鉴权读取并比较字节。确认测试部署只存在三个常驻服务且没有 Next 进程。不得用猜测的 SSE/媒体路径或单元测试代替上述部署证据。

## 未执行项目

生产容器启动、空 PostgreSQL migration、运行 healthcheck、实际 nginx routing、HTTPS/session/RBAC、浏览器 bundle 审计、SSE/断连/超时、媒体及授权下载、volume 持久化和所有重启/Next 停止场景均未完成。format/lint/typecheck/coverage/build/integration/E2E 完整质量门禁未执行成功。本次没有创建或删除 Compose volume，没有清空数据库或附件。
