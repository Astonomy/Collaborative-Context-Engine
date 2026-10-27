# S0：架构审计与前端性能基线

- 日期：2026-09-26；审计代码：`f66227d72a7d7b3c94a9030bbe6add2dff61647e`。
- 范围：仓库事实、生产构建、前端合成实验、迁移设计；本次仅修改文档。
- 决策：[ADR 0009](adr/0009-browser-api-boundary-and-vue-migration.md)；[Attachment 契约](multimedia-attachment-contract.md)。以下“建议”均非已实现能力。

## A. 当前 architecture map

```text
Browser：/（唯一业务页面；project/conversation/tab 是内存状态）
  CceWorkbench -> 各 Panel -> lib/api-client（fetch JSON / POST SSE）
       | @cce/api-contracts -> domain/shared 的运行时 schema + Zod
       | application 的 ProjectAccess 仅 import type
       v
apps/web/app/api/**/route.ts             apps/web/app/mcp/route.ts
       | server/request.ts（HTTP、认证、错误映射、输入/输出校验）
       | server/session-cookie.ts（cookie + AES-GCM）
       | server/queries.ts（授权和查询编排，尚未全部归入 application）
       v
apps/web/server/runtime.ts（composition root，进程内 singleton）
  application services / agents / mcp-server facade
       | domain / context-engine / conversation-import
       | application ports <- database / model-provider adapters
       v
PostgreSQL（evidence + canonical state） / 外部 ModelProvider
```

| 边界              | 实际位置与行为                                                                    | 审计结论                                                                                                                                                   |
| ----------------- | --------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 页面/server shell | `apps/web/app/page.tsx`、`layout.tsx`                                             | Server Components；page 只返回 Workbench，layout 提供 metadata、viewport、CSS；无服务端用户数据预取                                                        |
| 客户端交互        | `components/cce-workbench.tsx`、conversation/login/merge/project panels           | use client；浏览器执行 effects、事件、状态和 fetch；Client Component 首次仍可参与服务器预渲染，不能等同于“只在浏览器执行”                                  |
| 隐式 client graph | `context-panel.tsx`、`history-panel.tsx`、`lib/display.ts`                        | 即使没有 use client，也被 Workbench 静态导入，处于客户端模块图；隐藏 tab 不挂载，但代码不是按 tab 懒加载                                                   |
| REST transport    | `app/api/**/route.ts`                                                             | 30 个 API route 文件，包括 health/session、项目、成员、会话、chat、extraction/delta、context、merge、imports、agents、audit；动态路由不是业务 HTML 页面    |
| MCP transport     | `app/mcp/route.ts`                                                                | 独立的已有 provider-facing Streamable HTTP facade；共享认证/application，不应在迁移中遗漏；REST 仍为公共应用 API                                           |
| 认证              | `server/request.ts`、`app/api/session/route.ts`、application `session-service.ts` | Bearer 优先；否则解密 cookie 后用 token hash 查用户；cookie 写请求校验 Origin，session POST/DELETE 也校验 Origin；RBAC 留在服务端                          |
| session adapter   | `server/session-cookie.ts`                                                        | v1 AES-256-GCM，8 小时期限，HttpOnly、SameSite=Strict、生产 Secure、path=/；加解密本身可复用，NextResponse cookie 写法需要替换                             |
| server-only 实现  | `server/runtime.ts`、request/cookie、所有 route handlers                          | crypto、Buffer、process.env、pg、provider 配置不得进入 client；目录命名不是编译期隔离机制，当前无 `server-only` poison import                              |
| composition root  | `server/runtime.ts`                                                               | 配置校验、ID/clock/hash、PG pool（max=20）、UoW、provider、services、session codec；迁移的是装配/生命周期，不是业务规则                                    |
| 边界偏移          | `server/queries.ts`                                                               | 成员/merge list/detail 查询直接编排 UoW + authorization；迁移时应归入 application use cases，避免新的 HTTP host 复制规则                                   |
| shared TypeScript | `packages/api-contracts`、domain/shared 的纯 schema/type、`lib/display.ts`        | schema 是实际运行时代码，type import 擦除；不可把整个 application/database barrel 视为 browser shared。api-contracts 的 domain schema 依赖会增加客户端代码 |

证据入口：[Workbench](../apps/web/components/cce-workbench.tsx)、[request](../apps/web/server/request.ts)、[runtime](../apps/web/server/runtime.ts)、[queries](../apps/web/server/queries.ts)、[API client](../apps/web/lib/api-client.ts)、[ESLint](../eslint.config.mjs)。ESLint 限制 domain/context-engine 的部分反向依赖，但 web 同时启用 Node/browser globals，没有专门的 client 禁止导入规则。当前边界依赖开发纪律与构建，不能称为完整的静态安全保证。

## B. Production baseline

### 环境、方法与范围

Windows，AMD Ryzen 7 8845H，16 logical processors；Node 24.15.0、pnpm 11.22.0、仓库锁定 Next 16.3.4、React 19.2.8。已安装依赖直接用于 `pnpm build`，无安装、升级或新依赖。构建使用 Turbopack，成功编译 5.7 s、Next TypeScript 阶段 9.9 s、静态生成 152 ms；这些是单次构建日志中的阶段时间，不是冷构建总耗时。

生产产物 `.next/server/app/index.html` 为 5,692 bytes。从 HTML 的 script/link JS 引用去重后计算原始 bytes 和每个文件 `gzipSync(bytes, { level: 9 })`，压缩值是离线可比尺寸，不是浏览器实测传输量。包含 HTML 标记为 nomodule 的兼容脚本，因此是 HTML 引用集合上界，不能宣称现代浏览器执行全部 7 个文件。

| JS chunk                     |  原始 bytes | gzip-9 bytes |
| ---------------------------- | ----------: | -----------: |
| `0cz1d0mv5g_q7.js`           |     112,594 |       39,520 |
| `10zfunfy8kpsd.js`           |     360,468 |       84,223 |
| `1sgcetnq4uvby.js`           |      16,879 |        5,920 |
| `262akway5md93.js`           |     183,088 |       48,252 |
| `263ynslmiwojj.js`           |      14,384 |        3,655 |
| `2w8cr9y56iucw.js`           |     229,151 |       71,472 |
| `turbopack-1p8ka0wxkf6-1.js` |      10,913 |        4,289 |
| **合计**                     | **927,477** |  **257,331** |

其中 `0cz1d0mv5g_q7.js` 标记 `noModule`。排除此兼容脚本后，现代浏览器候选加载集为 6 JS、814,883 bytes、gzip-9 217,811 bytes；仍须以 Resource Timing 核实实际请求/缓存，而非视为已测网络传输量。后续对照需同时报告全部 HTML 引用和现代浏览器加载集，避免计算口径变化产生虚假优化。

CSS `2c-voqrzfokfd.css`：15,845 bytes，gzip-9 4,185 bytes。不把 standalone server 大小、server dependency trace 或 `transpilePackages` 列表当成 browser bundle。没有 source-map 归因实验，不能把某个 chunk 的全部尺寸归为 React、Next 或 Zod。

客户端源码沿 imports 检查；静态 JS 对 `node:crypto`、`node:fs`、`PostgresUnitOfWork`、`DATABASE_URL`、`CCE_SESSION_SECRET`、`QwenVllmModelProvider`、`pg-protocol`、`drizzle-orm`、`sharp` 搜索无命中。结论是“未发现 Node-only 泄漏证据”，而非关键词搜索证明不存在任何泄漏。`serverExternalPackages: ["pg"]` 是服务端打包设置，不是客户端授权边界。

### 浏览器合成实验

`pnpm --filter @cce/web start --port 3107`，headless Chromium 151.0.7922.34，1365×900，CPU/网络不限速，localhost 生产 JS；每组 5 次全新 browser context，API route interception 禁用 HTTP cache，服务端/OS cache 未清空。每个 API 人工等待 100 ms，然后返回 schema 合法 fixture；不连接 PostgreSQL、不调用模型。

session/project/member/conversation 使用 `tests/e2e/golden-flow.spec.ts` 的固定数据。登录场景返回 session 401；会话场景为 1 project、1 conversation、空 context/commits/merges，20 或 1,000 条 completed user message。每条 content 为 `Audit {index} ` + 200 个 x，message ID 和 clientMessageId 为 `00000000-0000-4000-8000-` + 从 100 起的十二位十进制后缀，其余字段符合 messageSchema。早期缺少 clientMessageId 的 fixture 被 schema 拒绝，已排除失败样本。

| 场景（5 次）         | TTFB median ms | FCP median ms | LCP 观察值 median ms | locator 确认完成 median ms | DOM elements | API GET 数 |
| -------------------- | -------------: | ------------: | -------------------: | -------------------------: | -----------: | ---------: |
| 未登录 shell → login |            3.5 |            56 |                  248 |                      299.8 |           39 |          1 |
| 20 messages          |            3.6 |            64 |                  596 |                      910.9 |          216 |          7 |
| 1,000 messages       |            3.3 |            60 |                  652 |                      902.6 |        5,116 |          7 |

原始 LCP 样本：login `[248,244,248,248,240]`；20 `[616,596,596,592,588]`；1000 `[656,656,652,648,652]`。原始 locator 完成样本：login `[299.8,303,293.2,296.6,308.4]`；20 `[917.4,910.9,915.4,903.4,896.1]`；1000 `[909.6,908.5,902.1,902,902.6]`。

FCP 是 loading shell，不是可操作工作台。LCP 是 locator 完成后再等 100 ms 时 PerformanceObserver 的最后一个 candidate，不是完整真实会话的 field LCP。locator 使用 Playwright `waitFor`（login button 或最后一个 `.message`），受轮询延迟影响，只是就绪时间上界；不能从 1,000 条 locator 数值略低推出大列表更快。三组均未观测到 >50 ms long task，但没有测 INP、连续 SSE 更新 CPU、内存、真实 SQL、并发/网络或移动设备。五次样本不足以提供可靠 p95。

20-message 首次样本请求开始时间（navigation 后 ms）：session 136 → projects 240.5 → conversations/context/commits/merges 367.7–367.8 → messages 494.3。源码与实测一致：**7 GET，4 级数据等待**。project/conversation 并非独立 URL；不存在分别测量 `/projects/...` HTML 的现成页面。

生产 start 命令成功服务页面，但 Next 发出 standalone 启动警告。该实验适用于生产前端产物，不代表 Docker standalone 部署基线；后续部署比较须使用 `docs/deployment.md` 的 standalone 布局。

### Bottleneck table

| 项目                                 | 证据及影响                                                                                                       | 归因 / 优先级               | 后续验证或处理                                                                   |
| ------------------------------------ | ---------------------------------------------------------------------------------------------------------------- | --------------------------- | -------------------------------------------------------------------------------- |
| 首次 loading + 全工作台 client graph | page 无数据；顶层 use client；所有 panel 静态导入                                                                | CCE 渲染/组件设计，P1       | 首屏/hidden tabs 分包；对比同等功能加载集                                        |
| 请求 waterfall                       | session → projects → 四路 Promise.all → messages；慢历史/merge 阻塞会话                                          | CCE data fetching，P1       | messages 只依赖 conversation；history/merge 按需加载；保持授权                   |
| 大组件/状态耦合                      | Workbench 642 行、ConversationPanel 390、MergePanel 223（按换行分割计数）；stream delta 更新顶层 state           | CCE component/state，P1     | 流文本局部更新、稳定 props；profile 后决定批处理策略，不仅按行数拆分             |
| 长列表/JSON 体积                     | conversation/messages/current context/commits/merges 全量；message `.map` 无窗口；1000 条 5116 DOM               | CCE API、DB、UI，P1         | cursor pagination + bounded response + 窗口渲染；数据规模/选择状态回归           |
| 历史读放大                           | database `listCommits` 全量，再 `loadCommits` 批量读 sources/changes/item versions/provenance                    | CCE read model，P1          | 分页摘要、detail 按需；这是批量级联查询，不应误称逐 commit N+1；SQL latency 未测 |
| 重复请求                             | 切回 project 重取四路、切回 conversation 重取 messages；no-store，无客户端去重/缓存                              | CCE state/data，P2          | project+resource+版本键控缓存与 mutation invalidation；不能删除 server RBAC      |
| finalize 刷新                        | projects 后再 context/commits/merges；同 project ID/session 未变，不能据此断言 effect 再发重复四路               | CCE 顺序/一致性，P2         | trace 精确失效范围；写后 HEAD 一致性优先                                         |
| dev 双 effect                        | reactStrictMode 开启；effect 有 AbortController                                                                  | 开发环境行为                | 不把 dev 重放当作 production 重复请求；实测 production 无额外 bootstrap GET      |
| SSE                                  | POST fetch + ReadableStream；server 等 first event 后返回；client 每 delta setState；Workbench 未传 abort signal | CCE stream 生命周期，P1     | 切项目/会话、退出时取消并隔离旧事件；测 first-event/provider first-token 分开    |
| runtime 冷初始化                     | authenticate 调用 singleton，首次创建 pool/provider/config；每 API 自己认证/授权                                 | CCE server 装配/必要授权    | 测真实冷启动与 pool queue；不通过跳过认证提升指标                                |
| framework runtime                    | Next/React 路由、RSC bootstrap、hydration 支持有成本；当前只预渲染 loading                                       | 框架固定开销 + CCE 使用方式 | 本次未测 Vue 或 React/Vite 对照，无法量化净节省；无证据认定 Next 性能缺陷        |
| 边界保护                             | 无 Node-only 关键词命中，但无 client import 禁令                                                                 | 工程约束，P1                | 自动 client graph 检查，禁止 server/adapter/node imports；压缩后搜索只作补充     |

### 复现与后续采样协议

1. 在上述 commit、相同锁文件/Node/pnpm 下 `pnpm build`。记录 build log；用 Node fs 读 `apps/web/.next/server/app/index.html`，以 `(?:src|href)="([^"?]+\.js)(?:\?[^\"]*)?"` 提取并去重，映射至 `.next/static/chunks`，原始 Buffer.length 与 gzip level 9 分别求和。单独记录 nomodule 与浏览器实际 resource 集合。
2. 用上述 start 命令启动；现有 `@playwright/test` 的 chromium.launch 创建浏览器，每次 newContext。`page.route('**/api/**', ...)` 记录 path、`performance.now()`，延迟 100 ms 后 fulfill JSON；非 session/project/conversation/context/messages 列表返回 `[]`；不要访问真实模型或使用真实 token。
3. addInitScript 注册 buffered `paint`/`largest-contentful-paint`/`longtask` observer；goto 后等待 login 的 `Continue securely` 或 `.message` 的 nth(N-1)，记录 performance.now，再等 100 ms 读取指标与 `document.querySelectorAll('*').length`。各场景 5 次并保留原始样本。不得用 dev server 的数值混入 production baseline。
4. 后续正式对照：至少 30 次、固定 browser/硬件、CPU 4× slowdown、150 ms RTT/1.6 Mbps 下行/750 Kbps 上行与不限速两组；冷 browser cache 与 warm 分开。记录 navigation→首条可见消息的直接 performance mark、LCP、交互 event timing、JS encodedBodySize、解析/执行时间、DOM、heap、SSE 首事件/取消、各 endpoint latency/payload；禁用 locator 轮询作为精确 ready 指标。
5. 真实 server 层另用隔离 PostgreSQL 18，空库 migrations + deterministic seed（20/1000/10000 messages，100/1000 commits），固定模型替身；记录 SQL query count/time、pool wait、p50/p95、错误率。`playwright.config.ts` 默认 dev server，现有 E2E 成功不等于 production 性能通过。

## I. 本 scope validation

- `node --version`、`pnpm --version`、`git rev-parse HEAD`：记录环境/版本。
- `pnpm build`：通过；不涉及 schema migration。
- `pnpm --filter @cce/web start --port 3107`：运行成功，有 standalone 启动警告。
- PowerShell here-string → `node`：fs/zlib 产物统计；现有 Playwright 驱动的 production UI 合成实验（5×3 有效样本）。两个探索脚本的 locator/fixture 错误不计入有效样本，未更改业务代码。
- 静态 `rg` 导入/敏感依赖搜索：上述关键词无命中；这类搜索无命中的 exit 1 不代表构建失败。
- `pnpm exec prettier --write` / `--check`（仅本次 4 个文档）：通过；`git diff --check`：通过。
- `pnpm format:check`：失败，报告 63 个既有文件格式问题（包含 `.prettierrc.json`、现有 TS/测试/config 等），本次 4 个文档均通过；没有扩大范围修复。
- 没有执行 lint/typecheck 独立命令或 unit/coverage/integration/E2E 全套；build 内含 TypeScript 检查。本次是文档变更及定向性能采样，不宣称 `pnpm validate` 或完整 Definition of Done 已通过。

构建自动改写的 `apps/web/next-env.d.ts` 已恢复为审计前版本。benchmark 无持久脚本、长期依赖、lockfile 或业务代码变更。
