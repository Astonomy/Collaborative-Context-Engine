# ADR 0009: Separate browser delivery from the HTTP host before deciding on Vue

- Status: Proposed（S0 设计；尚未实施或替代已接受的 ADR 0002）
- Date: 2026-09-26
- Evidence: [S0 architecture/performance baseline](../s0-architecture-performance-baseline.md)
- Related: [ADR 0002](0002-modular-monolith-and-dependency-direction.md)、[Attachment contract](../multimedia-attachment-contract.md)

## C. Decision analysis

**建议先建立 framework-neutral HTTP 边界；不建议仅以“Vue 更快”为由立即重写。Vue/Vite SPA 是条件式目标，是否采用由等功能对照与团队维护收益决定。** 当前页面已经主要按 SPA 工作：Next page 只输出 loading shell，没有业务 SSR；迁移可减少对 Next server 的耦合，但现有 waterfall、全量读取与顶层状态更新不会因 Vue 自动消失。

| 维度                   | 保留 Next 并优化                                   | Vue/Vite SPA + 独立 HTTP host                                          | 决策依据                                                                            |
| ---------------------- | -------------------------------------------------- | ---------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| Framework overhead     | 保留 Next/React runtime；可利用现有 SSR/RSC 能力   | 替换为 Vue runtime，去掉 Next/RSC 客户端路径；新增必要路由等成本需纳入 | 未构建 Vue 对照，不能承诺 bundle/CPU 数字；React/Vite 是隔离“去 Next”收益的可选对照 |
| Bundle/component       | 拆分 Workbench、lazy tabs、控制 schema 导入        | Vue 同样需要拆分；模板/components/tests 都需改写                       | 组件设计收益不能归为框架收益                                                        |
| Data fetching          | 可改 effect 依赖、按需加载或服务端预取             | 显式客户端 fetch、取消、去重、缓存失效                                 | 两方案都需消除不必要串行，不以额外 bootstrap API 为先决条件                         |
| Server/client boundary | 强制 client import 限制，仍保留 Next host          | 浏览器 package 只依赖安全 DTO/schema；Node host 独立                   | 首先抽离边界，SSR 并不意味着浏览器能访问 DB                                         |
| Rendering              | SSR/RSC 可改善业务首屏，但会新增服务端用户数据路径 | 静态 SPA 首屏仍等 JS/API；首个 mount 不再 hydrate SSR 业务树           | 当前 SSR 收益有限；未来 public/SEO 页面需求出现时重审 SPA 选择                      |
| State management       | React hooks 可局部化；无需先加库                   | Vue composables 可实现；不预设必须 Pinia 或 query library              | project/conversation/HEAD 键控与旧事件隔离比库名称重要                              |
| API architecture       | route handlers 继续适配 HTTP                       | Web Request/Response 风格 handlers，Node adapter 管流/关闭             | 保留 REST、SSE、MCP facade 与所有用例；不改 GraphQL，不拆微服务                     |
| 成本                   | 最小行为回归风险                                   | UI/component tests、routing、build、deploy、运维全面迁移               | 架构与维护收益需书面记录，不能用虚构性能收益抵消成本                                |

## D. Target architecture and directory decision

```text
Same-origin ingress
  / + static assets -> browser build（条件式 Vue/Vite SPA）
  /api/* + /mcp    -> Node.js 24 HTTP host
                       auth/session + REST/SSE/MCP adapters
                       composition root / shutdown / health
                            |
                 packages/application + packages/agents
                     domain / context-engine / conversation-import
                            |
           ports <- packages/database / packages/model-provider
```

保留 modular monolith 和单一部署边界：一个 Node host 可以同时提供静态文件及 API；不要求两个公开 origin 或微服务。静态资源也可由 ingress 分发，URL 保持同源，cookie/Origin 规则无需为迁移放宽。

目录沿现状决定：迁移完成后 **`apps/web` 继续表示 browser UI**，不再包含可执行服务端代码；新 **`apps/api` 是后续 scope 拟新增的 deployable composition root**，原因是 repo 已用 apps 放入口、packages 放复用核心，而非为了套图。本 scope 不创建该目录。过渡期可让新 host 先只接管 API，旧 `apps/web` 继续提供 Next UI；Vue 试验构建在隔离分支/产物中完成，不提前建立第二套永久生产 UI。`packages/api-contracts` 保留 browser-safe REST/SSE DTO；application 的 type-only UI 依赖后续收敛为 transport DTO；不创建无归属的通用 shared 包。

数据库、provider 与 MCP SDK 都留在服务端。domain/context-engine 不新增 HTTP、Vue、React、存储 SDK 或模型 SDK 依赖。HTTP 框架具体选型不在 S0 固定；实现者先验证流取消、backpressure、cookies、限制请求体和 graceful shutdown，再按依赖政策审查。

### 消除 Next server responsibilities 的逐项归属

| 当前 Next/web 责任                        | 后续归属与兼容条件                                                                                                                                            |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `app/api/**/route.ts`                     | apps/api HTTP adapters；保留 method/path、状态码、DTO、idempotency-key、x-request-id、cache headers；Next params Promise 转为 host 路由参数，不泄漏入核心     |
| `server/request.ts`                       | apps/api transport；用标准 Request/Response + cookie adapter 替代 NextRequest/NextResponse；8 MiB JSON cap、严格 UTF-8、重复 query 拒绝、error mapping 均保留 |
| `server/session-cookie.ts`、session route | apps/api auth adapter；维持 v1 codec、cookie 名称/path/寿命/flags 和同一 secret；Bearer 优先和 Origin 校验不得退化；上线前验证 ingress URL/origin 处理        |
| `server/runtime.ts`                       | apps/api composition root；保持进程内 pool/service 生命周期，新增 host 对应的关闭挂钩由后续 scope 测试；不在 core 读取 env                                    |
| `server/queries.ts`                       | application 负责 authorization/UoW/query orchestration；HTTP host 仅解析/调用/输出                                                                            |
| chat route SSE                            | host 负责 streaming、disconnect/abort、flush、error event、first-event gate；保留 fetch POST SSE，不能直接替换为只支持 GET 的 EventSource                     |
| `/mcp`                                    | apps/api 挂载现有 `packages/mcp-server`；维持 bearer/cookie 认证、bounded body、现有 GET/POST/DELETE 行为                                                     |
| next.config security headers              | host/ingress 提供 CSP、HSTS、nosniff、frame/referrer/permissions/COOP/CORP；不静默丢失，不为 SPA 放宽 auth                                                    |
| layout metadata/globals.css               | browser HTML entry/样式；React JSX/hooks/component tests 转为 Vue 等价行为；并非可直接重用的 TS                                                               |
| standalone Docker/start/health            | 重写为新 host + 静态 build 的部署产物；`/api/health` 数据库 readiness、非 root、只读文件系统与迁移 job 保留                                                   |
| Next build/types/lint                     | browser Vite + Vue typecheck、host TS build 与边界检查；最终确认无 Next runtime/import/启动路径后才移除依赖                                                   |

## E. Attachment boundary

采用[独立 Attachment 契约](../multimedia-attachment-contract.md)。Attachment 是 Message 关联的不可变证据资源，上传/验证/preview 不创建 canonical context；语义变化仍由 Delta → review → immutable ContextCommit 完成。浏览器永远不得直连 DB、持有 storage secret、执行任意上传模型/脚本、import Node-only parser/codec 或绕过 object-level authorization。

## F–G. Ownership and execution order

以下 ownership 是后续 scope 的职责边界，不是已经开工的任务或对具体人员的指派。

| 顺序 / scope             | Owner                                    | 交付与边界                                                                                                     | 依赖 / 放行条件                                           |
| ------------------------ | ---------------------------------------- | -------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------- |
| S0 当前                  | Architecture                             | baseline、ADR、Attachment contract                                                                             | 本文档；无产品实现                                        |
| S1 观测与现有 UI 优化    | Frontend performance；API owner 配合分页 | 固定 benchmark、消除 waterfall、按需读取/分包、stream 生命周期；分别提交可归因变更                             | 先保留 Next 作优化后的公平对照；API 变化须兼容            |
| S2 HTTP 解耦             | Backend/application + security           | 搬移 composition/auth/transport，queries 归 application；REST/SSE/MCP parity                                   | 可继续接现有 Next UI；真实 PG 和 HTTP contract gate       |
| S3 Vue 决策试验          | Frontend architecture                    | 在相同 API、payload、渲染策略下比较优化后的 Next 与 Vue；覆盖 login/project/conversation/context/history/merge | S1 基线 + S2 API；性能及维护收益满足标准才批准完整迁移    |
| S4 UI 切换               | Frontend + QA + platform                 | Vue 等价 UI、URL/状态/取消/可访问性、部署切流；移除 Next                                                       | S3 通过；canary/rollback 预演；保留旧产物                 |
| A1 Attachment 持久化/API | Domain/application + database + security | schema/ports、immutable links、对象存储授权、验证生命周期；单独迁移评审                                        | 契约确认后可独立排期；不以 Vue 为依赖，不与 S2 切流同批   |
| A2 媒体处理/preview      | Infrastructure/model-runtime + security  | 隔离 parser/codec、资源上限、derived evidence、ModelProvider 能力                                              | A1；模型调用仍走 ModelProvider；不默认启用自动 extraction |
| A3 Attachment UI         | Frontend + QA                            | 上传/状态/预览/失败重试与 evidence attribution                                                                 | A1/A2 API 稳定；可在 React 或 Vue 实现                    |
| 发布门禁                 | Platform + QA                            | build、契约/权限/PG/E2E、容量与回滚验证                                                                        | 每个实施 scope 独立达到仓库 DoD，不以 S0 文档代替         |

推荐主线 S1 → S2 → S3 →（决策通过）S4。Attachment 主线 A1 → A2 → A3 独立，避免框架迁移同时引入数据语义变更。若 S3 未证明价值，保留优化后的 Next UI + 独立 HTTP 边界，不强制完成 Vue 重写。

## Rollback strategy

1. S2 先按环境/canary 配置切换同源 `/api/*`、`/mcp` upstream，UI 暂留旧 Next。保留旧 Next server 镜像与 endpoint contract；切回 upstream 即可回退。每个请求只进入一个实现，不双写、不向两个 host 重放 mutation。
2. S4 静态 UI 切换与 API 发布独立。保留上一版完整 HTML + hashed assets，按完整版本回切；旧资源至少保留覆盖回滚窗口，防止 HTML/chunk 错配。过渡 cookie secret/codec 兼容，回退无需用户重新提交 token。
3. SSE canary 按连接黏附，旧实例先 drain；取消/中断后按既有 message/clientMessageId 语义恢复，不自动重发有副作用 POST。不假定切流能恢复旧 stream。
4. 性能迁移不做破坏式 schema 变化。未来 Attachment 采用 expand/contract，旧服务可忽略新增表但不得读取后覆盖 attachment 证据；兼容性验证失败则停用新入口而不是删除 evidence。数据库不做 down migration，不重写 ContextCommit/history。
5. 若出现任一跨 project 访问、cookie/Origin 回归、证据/HEAD 不一致，立即停切并回滚；同环境 API p95 或 UI ready p75 相比对照恶化 >10% 且连续两轮复现，也停止推广。发布前演练 upstream + assets 回切 ≤10 分钟，记录丢失请求/stream 与恢复情况。

## Measurable acceptance criteria

这些是后续 gate 的拟定标准，不是 S0 已达成的性能承诺。

- 公平对照固定 payload、CPU/网络、browser、同一 API host、相同认证和功能；30 次以上冷/热分组。以 S1 优化后的 Next 为对照，同时保留 S0 原始值。Vue 推荐门槛：初始 JS gzip-9 集合或直接打点 ready p75 至少改善 20%，另一项不得恶化 >5%；并记录 UI 迁移成本与维护收益。仅减少功能、去掉 schema 校验或改变 fixture 不算改善。
- 首个会话加载目标 ≤5 GET、≤3 级数据依赖；历史/merge 不在 messages critical path；一次初始加载对同一 resource 无重复 GET。LCP p75 ≤2.5 s、交互延迟 p75 ≤200 ms、CLS ≤0.1 在约定受限环境测量；无法满足时须先报告原因，不以 localhost shell FCP 代替。
- 1,000/10,000 messages 场景，初始渲染 message DOM ≤100 条、每页 ≤100 条，能连续读取完整证据且 sequence 无缺失/重复；每个 payload 有明确 bytes cap。历史分页不能改变 extraction 的 throughMessageSequence 或完整证据语义。
- UI 关键流程（登录/退出、项目/会话创建重命名归档、chat/extract/agent/review/finalize、viewer denial）等价；快速切换/退出后旧请求与 SSE 不得写入新项目状态；显式测试 401/403/404/409/413/429/503 和 schema-invalid response。
- HTTP parity 覆盖全部既有 REST route 与 `/mcp`，headers、cookie、Origin/Bearer、SSE 顺序/取消/失败一致；真实 PG 验证 project/object scope、append-only、idempotency、并发 HEAD 与原子 rollback。分页/new API 单独版本兼容评审。
- 浏览器依赖图禁止 database/model-provider/mcp-server SDK、server modules、Node builtins、parser/codec；secret 搜索 + import graph gate 均通过。API host/core 不依赖 Next/Vue，核心依赖方向不变。
- 每个实施 scope 运行适用完整质量门禁：format、lint、typecheck、unit/coverage、build、PG integration（空库 migrations）、E2E；`pnpm validate` 只包含 Docker-free gate，不能代替 `pnpm verify:full`。deployment health/security headers、SSE 代理配置和回滚演练纳入发布验收。

## Consequences

解耦 transport 增加一个清晰的 host 边界及其测试/运维工作，同时保留 TypeScript 核心和 PostgreSQL 唯一真源。Vue 决策保持可撤销；Attachment 不绑架框架迁移。批准实施后再更新 ADR 0002 的单 Next deployable 决策，S0 不将目标架构写成当前事实。
