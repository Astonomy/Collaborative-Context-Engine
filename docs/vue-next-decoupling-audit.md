# Vue / Next.js runtime decoupling audit

Current deployment (2026-10-08): default scripts build and run static Vue plus independent Node API.
Next is an explicit legacy option. See [deployment](deployment.md); earlier host dependency findings
below describe the migration baseline.

2026-10-08 frontend update: Vue now has a configurable standalone API connection
boundary for REST, POST SSE, uploads and media, plus structured message attachment
DTOs. The historical topology below still describes the repository's default host
and packaging. See [current endpoint matrix, verification and remaining dependencies](vue-api-endpoints.md).

审计日期：2026-10-05。对象是当前 workspace（包括已有未提交及未跟踪的 Vue、API、附件实现），不是仅 HEAD。以下结论基于源码、路由导出及启动/构建配置；不代表线上部署实测。

**结论：Vue 已替换默认 UI，HTTP runtime 尚未脱离 Next.js。** REST/SSE handlers、认证和 composition root 已抽到 `apps/api`，但该目录没有独立 package manifest、监听入口或 start/build 脚本，`tsconfig.json` 仍是 `noEmit`。现有 Next routes 调用这些模块；`/mcp` 仍直接挂载在 Next。停止 Next 后，当前默认部署的页面、API、登录、附件和 MCP 均失去入口。

## Current topology

```text
Production / pnpm start
  Browser
    -> Next.js apps/web (Node listener, default port 3000)
         / -> redirect /vue/
         /vue/assets/* -> staged Vue assets
         /vue/* -> Vue SPA shell + browser routing
         /legacy -> previous React UI

  Vue SPA (or legacy UI)
    -> same-origin /api/* (JSON / binary / POST SSE)
      -> apps/web/app/api/**/route.ts
        -> apps/api/handlers/**/route.ts (Request/Response, injected services)
          -> apps/api/server/runtime.ts (composition root)
            -> application / agents / context-engine / domain
              -> database adapter -> PostgreSQL (source of truth)
              -> storage adapter -> private local attachment directory
              -> ModelProvider adapter -> configured model runtime

  Plugin / MCP client
    -> http://localhost:3000/mcp (checked-in plugin default)
      -> apps/web/app/mcp/route.ts (auth + bounded body)
        -> packages/mcp-server (WebStandard Streamable HTTP)
          -> application (projects / conversationImports)
            -> database adapter -> PostgreSQL

Development / pnpm dev
  scripts/dev.mjs -> Next :3000 + Vite :5173
  Browser :3000/vue/* -> Next rewrite -> Vite /vue/*
  Browser :3000/api/* -> Next -> API handlers -> application
  Browser directly on Vite :5173 (or preview :4173)
    -> /api/* -> Vite proxy -> Next :3000 -> API handlers
```

运行入口证据：[根 package.json](../package.json)、[dev launcher](../scripts/dev.mjs)、[Dockerfile](../Dockerfile)、[web package](../apps/web/package.json)。Docker runner 复制 `.next/standalone` 并执行 `node apps/web/server.js`，并非独立 API server。[compose.yaml](../compose.yaml) 只声明 PostgreSQL。

页面宿主证据：[首页 redirect](../apps/web/app/page.tsx)、[Vue catch-all route](../apps/web/app/vue/[[...path]]/route.ts)、[vueShell](../apps/web/server/vue-shell.ts)、[Next rewrites / security headers](../apps/web/next.config.ts)。[stage-vue](../scripts/stage-vue.mjs) 把 Vue 输出复制到 `apps/web/public/vue`；[stage-web-runtime](../scripts/stage-web-runtime.mjs) 再复制到 Next standalone 输出。HTML fallback 只覆盖 Vue 页面，缺失 assets 保持 404。

## Next.js runtime responsibilities

表中“必须迁移”指将责任交给独立 API 或静态宿主；已抽离模块应复用，无须复制业务逻辑。

| Responsibility                                      | Current file                                                                                                              | Consumer                                   | Must migrate?                                         |
| --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------ | ----------------------------------------------------- |
| REST 路由注册、method dispatch、Promise params 适配 | `apps/web/app/api/**/route.ts` → `apps/api/handlers/**/route.ts`                                                          | Vue、legacy、REST clients                  | 是；通用 handlers 已抽出，独立 listener/router 未落地 |
| SSE                                                 | `apps/web/app/api/projects/[projectId]/conversations/[conversationId]/chat/route.ts` → 同路径 `apps/api/handlers/...`     | Vue `streamChat`、legacy                   | 是；保留 POST stream、取消、错误事件和禁缓冲 headers  |
| auth                                                | `apps/web/server/request.ts` → `apps/api/server/request.ts::authenticateRequest`                                          | 全部受保护 REST / MCP                      | 是；通用认证已抽离，MCP 仍经过 NextRequest wrapper    |
| session                                             | `apps/web/app/api/session/route.ts` → `apps/api/handlers/session/route.ts`；`apps/api/server/session-cookie.ts`           | Vue bootstrap/login/logout、cookie clients | 是；cookie 加解密、有效期、Origin 检查保留在服务端    |
| attachments 元数据、上传、关联                      | `apps/web/app/api/projects/[projectId]/{attachments,conversations}/.../route.ts` → API attachment handlers                | Vue 上传、附件列表与详情                   | 是；原始二进制请求必须进入服务端 attachment service   |
| media streaming / inspection                        | `apps/api/server/attachment-content.ts`；API `attachments/[attachmentId]/{content,inspection}/route.ts`，由 Next 路由暴露 | image/video/model previews、下载           | 是；流桥接、Range、授权、下载 headers 均需保留        |
| MCP endpoint                                        | `apps/web/app/mcp/route.ts`；`packages/mcp-server/src/index.ts`                                                           | submit plugin / MCP clients                | 是；目前 API handlers 中没有 MCP 挂载                 |
| composition root                                    | `apps/api/server/runtime.ts::createServerRuntime/getServerRuntime`；`apps/web/server/runtime.ts` 仅重导出旧名字           | REST、MCP                                  | 已抽离实现；必须由独立 host 初始化和管理生命周期      |
| database wiring                                     | `apps/api/server/runtime.ts` → `packages/database/src/connection.ts`、`repositories.ts`                                   | application services                       | 是，迁移宿主；PG pool / UnitOfWork 保留服务端         |
| model provider wiring                               | `apps/api/server/runtime.ts` → `packages/model-provider/src/configuration.ts`、`openai-compatible-provider.ts`            | chat、extraction、agents                   | 是，迁移宿主；保留 ModelProvider port                 |
| storage wiring                                      | `apps/api/server/runtime.ts` → `packages/storage/src/local-attachment-storage.ts`                                         | upload/download/inspection                 | 是；继续使用私有持久目录                              |
| Vue HTML / assets / deep links                      | `apps/web/app/vue/[[...path]]/route.ts`、`apps/web/server/vue-shell.ts`、`scripts/stage-vue.mjs`                          | Vue 浏览器入口                             | 是，交给独立静态宿主/网关                             |
| security headers、dev proxy、production packaging   | `apps/web/next.config.ts`、`Dockerfile`、根 scripts                                                                       | 所有客户端                                 | 是；不能在移除 Next upstream 时丢失 CSP 等策略        |
| legacy UI                                           | `apps/web/app/legacy/page.tsx`、`apps/web/components/cce-workbench.tsx`、`apps/web/lib/api-client.ts`                     | `/legacy` 用户                             | 当前 scope 保留；目标运行图不再部署/经过它            |

### REST / SSE route inventory

以下按实际 `apps/web/app/api/**/route.ts` 的导出核对：**34 个 API 路径，45 个显式 method handlers**。表内每个路径对应 `apps/web/app{path}/route.ts`，通用实现对应 `apps/api/handlers{path 去掉 /api}/route.ts`。`[p]` 等缩写仅用于下表：`p=projectId`、`c=conversationId`、`a=attachmentId`、`r=runId`、`m=mergeRequestId`、`f=conflictId`、`i=importId`、`u=userId`，实际目录使用全名。

| Path                                                            | Explicit methods  | Responsibility           |
| --------------------------------------------------------------- | ----------------- | ------------------------ |
| `/api/health`                                                   | GET               | 数据库健康检查           |
| `/api/session`                                                  | GET, POST, DELETE | 当前身份、登录、退出     |
| `/api/projects`                                                 | GET, POST         | 项目列表/创建            |
| `/api/projects/[p]`                                             | GET, PATCH        | 项目访问详情/更新        |
| `/api/projects/[p]/audit`                                       | GET               | 审计                     |
| `/api/projects/[p]/context`                                     | GET               | Context snapshot         |
| `/api/projects/[p]/context/items`                               | GET               | Context items            |
| `/api/projects/[p]/context/commits`                             | GET               | Commit history           |
| `/api/projects/[p]/members`                                     | GET, POST         | 成员列表/添加            |
| `/api/projects/[p]/members/[u]`                                 | PUT               | 成员更新                 |
| `/api/projects/[p]/conversations`                               | GET, POST         | evidence conversations   |
| `/api/projects/[p]/conversations/[c]`                           | GET, PATCH        | conversation 详情/更新   |
| `/api/projects/[p]/conversations/[c]/messages`                  | GET, POST         | message evidence         |
| `/api/projects/[p]/conversations/[c]/chat`                      | POST              | SSE chat                 |
| `/api/projects/[p]/conversations/[c]/deltas`                    | POST              | 提取 proposal            |
| `/api/projects/[p]/conversations/[c]/extract`                   | POST              | extraction 入口          |
| `/api/projects/[p]/conversations/[c]/attachments`               | GET, POST         | 附件列表/上传            |
| `/api/projects/[p]/attachments/[a]`                             | GET               | 脱敏元数据               |
| `/api/projects/[p]/attachments/[a]/content`                     | GET               | 二进制/Range             |
| `/api/projects/[p]/attachments/[a]/inspection`                  | GET               | 只读派生媒体描述         |
| `/api/projects/[p]/imports`                                     | POST              | 导入                     |
| `/api/projects/[p]/imports/preview`                             | POST              | 导入预览                 |
| `/api/projects/[p]/imports/provider-previews`                   | POST              | provider submission 预览 |
| `/api/projects/[p]/imports/provider-submissions`                | POST              | 提交已预览 evidence      |
| `/api/projects/[p]/imports/[i]`                                 | GET               | 导入记录                 |
| `/api/projects/[p]/merge-requests`                              | GET, POST         | review 列表/创建         |
| `/api/projects/[p]/merge-requests/[m]`                          | GET               | review 详情              |
| `/api/projects/[p]/merge-requests/[m]/conflicts/[f]/resolution` | PUT               | conflict review          |
| `/api/projects/[p]/merge-requests/[m]/finalize`                 | POST              | 审核后 commit            |
| `/api/projects/[p]/agents/runs`                                 | GET, POST         | agent runs               |
| `/api/projects/[p]/agents/runs/[r]`                             | GET               | run 详情                 |
| `/api/projects/[p]/agents/runs/[r]/cancel`                      | POST              | cancel                   |
| `/api/projects/[p]/agents/runs/[r]/reconcile`                   | POST              | reconcile                |
| `/api/projects/[p]/agents/runs/[r]/resume`                      | POST              | approval/resume          |

[route-inventory.json](../apps/api/route-inventory.json) 漏列 conversation attachments 的 **GET**，实际 [Next wrapper](../apps/web/app/api/projects/[projectId]/conversations/[conversationId]/attachments/route.ts) 和 [API handler](../apps/api/handlers/projects/[projectId]/conversations/[conversationId]/attachments/route.ts) 均实现 GET。独立 router 不能直接依赖这份未修正的清单，否则 Vue 附件列表会断链。

另有 `/mcp` 的 GET/POST/DELETE 和 `/vue/[[...path]]` 的 GET。没有找到 `apps/web/pages/api/**`、Server Actions / `use server` 指令或独立 auth middleware。上述 method 数不包含框架自动生成的 HEAD/OPTIONS；迁移时仍需核对这些请求和未知 method 的 HTTP 行为。

## Vue dependencies on Next.js

Vue 源码依赖的是同源 HTTP contract，没有直接 import Next server；**当前路由宿主使这些调用在运行时全部经过 Next**。保留路径并切换 upstream 可以解除这类依赖，无须改成 Vue import server package。

以下路径前缀 `P=/api/projects/{projectId}`、`C=P/conversations/{conversationId}`；文件均位于 `apps/vue/src/`。

| File / call point                                                                                       | Actual request / consumer behavior                                                                                                                     |
| ------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `data/api-client.ts::apiPath/ApiClient.json/RequestScope.get`                                           | 注入或默认使用 fetch；仅接受 `/api/...` 相对路径；`credentials: same-origin`、`no-store`、`redirect: error`；JSON schema 校验                          |
| `data/use-resource.ts`                                                                                  | 页面 resource 通过 ApiClient 发 GET；不是另外一个后端                                                                                                  |
| `data/session.ts::bootstrap/login/logout`                                                               | `/api/session` GET/POST/DELETE；`views/LoginView.vue`、router 和应用 session 使用此路径                                                                |
| `views/ProjectsView.vue`                                                                                | `/api/projects` GET/POST                                                                                                                               |
| `views/ProjectView.vue`                                                                                 | `P` GET/PATCH，包括项目归档                                                                                                                            |
| `views/ConversationsView.vue`                                                                           | `P/conversations` GET/POST                                                                                                                             |
| `views/ConversationView.vue`                                                                            | `C` GET/PATCH；`C/messages` GET；`C/attachments` GET；`C/deltas` POST；`P/merge-requests` POST；`P/agents/runs` POST；`P/agents/runs/{id}/resume` POST |
| `views/ConversationView.vue::chat` → `data/chat-stream.ts::streamChat`                                  | `C/chat` POST fetch + ReadableStream 解码 SSE；并非 EventSource；中断后重读已持久化 messages，不自动重发 POST                                          |
| `views/ContextView.vue`                                                                                 | `P/context` GET                                                                                                                                        |
| `views/HistoryView.vue`                                                                                 | `P/context/commits` GET                                                                                                                                |
| `views/MergeView.vue`                                                                                   | `P/merge-requests` GET                                                                                                                                 |
| `components/MergeReview.vue`                                                                            | `P/merge-requests/{id}` GET；`.../conflicts/{id}/resolution` PUT；`.../finalize` POST（idempotency-key + expectedHeadCommitId）；`P` GET 刷新          |
| `attachments/AttachmentUpload.vue` → `data/api-client.ts::upload` → `attachments/upload.ts::uploadFile` | **XMLHttpRequest** POST `C/attachments`；发送原始 File、filename/client-message-id headers 和进度，不是 multipart 或 JSON                              |
| `views/AttachmentView.vue`                                                                              | `P/attachments/{id}` GET，作为独立预览页面的数据源                                                                                                     |
| `attachments/AttachmentRenderer.vue::inspect`                                                           | `P/attachments/{id}/inspection` GET，选择预览能力，失败退回文件卡片                                                                                    |
| `attachments/presentation.ts::contentPath`                                                              | 组装 `P/attachments/{id}/content`；不使用 storage locator 或直连对象存储                                                                               |
| `attachments/ImagePreview.vue` → `attachments/read-content.ts::readContent`                             | 同源 fetch content，检查大小，再创建 Blob URL 给 img                                                                                                   |
| `attachments/VideoPreview.vue`                                                                          | `<video src=contentPath(...)>`；浏览器原生请求 content/Range，绕过 ApiClient，但仍依赖同源 cookie                                                      |
| `attachments/ModelPreview.vue` → `read-content.ts`                                                      | 获取 content，再经 `model-worker-client.ts` / `model-worker.ts` 做浏览器隔离解析                                                                       |
| `attachments/FileCard.vue`、`AttachmentRenderer.vue`                                                    | content 下载链接及独立 preview 页面链接，也是运行时请求入口                                                                                            |
| `attachments/preview-path.ts::previewPath`、`router.ts`、`config.ts`                                    | preview 是 `${VITE_APP_BASE}projects/{p}/attachments/{a}` SPA 页面；默认 `/vue/`，不是服务端 `/preview` endpoint                                       |

配置与检索结果：

- [vite.config.ts](../apps/vue/vite.config.ts) 的 `CCE_API_PROXY_TARGET` 默认 **`http://localhost:3000`**；[Vue .env.example](../apps/vue/.env.example) 也写入此地址。dev/preview proxy **仅配置 `/api`，没有 `/mcp` proxy**。因此直接访问 Vite origin 的 `/mcp` 不能视为已接通 MCP。
- [build/api-proxy.ts](../apps/vue/build/api-proxy.ts) 的 `apiProxy/forwardedOrigin` 设置 `changeOrigin`，验证浏览器 Origin 后转换为上游 Origin，配合后端同源检查；替换 host 时需保留或重新核对这层行为。
- `src/config.ts` 只公开 `VITE_APP_BASE`。Vue 产品源码未发现 `axios`、`EventSource`、`WebSocket`、`NEXT_PUBLIC_*`、`API_BASE_URL` 或 `/mcp` 调用；Vite HMR 的 WebSocket 是开发工具链，不是业务 realtime channel。
- Vue 没有硬编码生产绝对 API origin，`localhost:3000` 主要在代理默认值、示例和测试配置。`/api/` 路径本身不专属于 Next；需要迁移的是宿主和部署映射。
- [Vue Playwright config](../apps/vue/playwright.config.ts) 默认连 `127.0.0.1:3000` 并通过根 `pnpm dev/start` 启动 Next；[根 Playwright config](../playwright.config.ts) 默认 `localhost:3000`。现有这些测试的通过不等于独立 API 已经可运行。

## Plugin/MCP dependencies

[插件 .mcp.json](../plugins/cce-conversation-submission/.mcp.json) 明确硬编码 `http://localhost:3000/mcp`，类型为 HTTP。[auth header helper](../plugins/cce-conversation-submission/scripts/cce-auth-headers.mjs) 从插件持久凭据配置读取 Bearer header；它不调用 `/api/*`、不上传文件，也不替换 endpoint URL。

```text
submit-cce-conversation skill (resolve -> preview -> approved submit)
  -> MCP client reads plugin .mcp.json + http_headers_helper
    -> /mcp on Next
      -> apiRoute + authenticateRequest + readBoundedRequestJson
        -> handleCceMcpRequest(Request, actor + services, parsedBody)
          -> list_projects -> ProjectService.list
          -> preview_conversation_import
               -> ConversationImportService.previewProviderSubmission
          -> submit_conversation_import
               -> ConversationImportService.submitProviderPreview
                 -> UnitOfWork -> PostgreSQL evidence / import provenance
```

入口为 [apps/web/app/mcp/route.ts](../apps/web/app/mcp/route.ts)，工具实现为 [packages/mcp-server/src/index.ts](../packages/mcp-server/src/index.ts)。MCP 包采用 WebStandard Streamable HTTP transport（`enableJsonResponse: true`），无 Next import、无 localhost 硬编码，也没有内部 loopback fetch `/api/*`。它直接调用注入的 application services。

REST 的 `POST P/imports/provider-previews` / `POST P/imports/provider-submissions` 是相同 use cases 的另一入口，**不是当前插件调用链的中间 HTTP hop**。迁移应在独立 API 上挂载 `/mcp` 并复用认证与 services，无需让 MCP 经 Vue 或 Next BFF 转发。

插件的 `file_reference` / `image_reference` 是 provider capture 中保留的引用。当前 [conversation-import service](../packages/application/src/conversation-import-service.ts) 的 `text()` 只投影文本 blocks 到 Messages；MCP dependencies 中没有 AttachmentService。**提交媒体引用不等于把本地 binary 上传成 Attachment**，无法据此保证 Vue content preview 可用。参考资料：[插件文档](plugins/cce-plugin.md)、[provider submission normalizer](../packages/conversation-import/src/provider-submission.ts)。

本节审查仓库内插件配置；客户端实际安装副本的 URL 可以另有配置，不能由仓库默认值推断。

## Attachment / image / video preview chain

```text
Local binary File
  -> AttachmentUpload / ApiClient.upload / XMLHttpRequest
  -> POST /api/projects/{p}/conversations/{c}/attachments (Next wrapper)
  -> API handler: auth, path, headers, attachmentRequestBytes
  -> AttachmentService.upload
       authorize -> bounded bytes + MIME policy
       -> LocalAttachmentStorage.put -> private file + checksum
       -> PostgreSQL transaction:
            Attachment(messageId, projectId, conversationId, actor)
            + human Message + attachment event + audit event
  -> toAttachmentResponse (storage omitted) -> upload response
  -> Vue reloads GET .../messages AND GET .../attachments
  -> attachmentsByMessage Map(messageId -> AttachmentResponse[])
  -> MessageList slot -> AttachmentCollection -> AttachmentRenderer
       -> GET /api/projects/{p}/attachments/{a}/inspection
            -> MediaProcessingService -> authorized bounded storage read
            -> HeaderMediaInspector -> preview capability
       -> GET /api/projects/{p}/attachments/{a}/content
            -> AttachmentService.download -> storage.open -> byte stream
            -> image Blob / video Range / model worker / download
```

关键实际行为：

1. 上传不是先创建一个无关联文件再由 UI 修改 Message。`AttachmentService.upload` 在授权和存储后，在同一个 DB UnitOfWork 内创建 attachment、human Message、event 和 audit；`clientMessageId` 用于重复提交比较，绑定不同 evidence 会冲突。原始文件写入不在 DB transaction 内；失败/不确定提交可能留下不可访问 orphan，现有代码不删除可能已关联 evidence 的对象。
2. [attachment DTO](../packages/api-contracts/src/attachment-contracts.ts) 明确去掉 `storage`。当前 [conversation contracts](../packages/api-contracts/src/conversation-contracts.ts) 的 `messageResponseSchema = messageSchema`、`messageListResponseSchema = z.array(messageSchema)`，**没有内嵌 `attachments[]`**。数组来自独立 `GET C/attachments`，在 [ConversationView](../apps/vue/src/views/ConversationView.vue) 按 `messageId` 拼接，最终作为组件 `attachments` prop。迁移需保存这两条 GET，不能假设 message DTO 已包含附件。
3. [inspection service](../packages/application/src/media-processing-service.ts) 是只读派生结果，不是持久转码任务；[HeaderMediaInspector](../packages/storage/src/media-inspector.server.ts) 使用 bounded header read，不生成 thumbnail。当前 API 没有独立 thumbnail/poster/preview binary endpoint；`previewPath` 指向 Vue 页面，实际媒体读 `/content`。
4. [content response](../apps/api/server/attachment-content.ts) 保持 `application/octet-stream`、attachment disposition、`nosniff`、`private, no-store` 和 sandbox CSP；有效 Range 返回 206，非法范围由 `attachmentRangeError` 返回 416。图片由客户端把受限 bytes 包为已验证 MIME 的 Blob；视频直接使用 content URL 并在失败时回退下载。迁移不能把文件目录公开以绕过该 endpoint。
5. 内容、metadata、inspection 均由服务端校验 project scope、成员权限和附件可用性。UI 的只读状态不是授权边界。上传产生 Conversation/Message evidence，不直接改变 canonical Context；后续仍遵循 Evidence → Proposal → Review → Commit。

## Server-only dependencies

对 `packages` 源码检索 `next/*`、`next/server`、`next/headers`、`next/cookies`、`NextRequest`、`NextResponse` **无命中**。API production handlers/server 同样没有 Next import；但 [apps/api/handlers/http-contract.test.ts](../apps/api/handlers/http-contract.test.ts) 导入 Next wrappers 做 parity test，这属于测试依赖，不是生产 handler 的反向依赖。`apps/web/server/request.ts` 与 `/mcp` 入口仍使用 `NextRequest`，首页使用 `next/navigation`，layout/config 仍有 Next 类型依赖。

“无 Next import”不表示 browser-safe：

| Files                                                                                | Server-only responsibility / boundary                                                                    |
| ------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------- |
| `apps/api/server/runtime.ts`                                                         | `node:crypto/path`、`process.env`；DATABASE_URL、CCE_SESSION_SECRET、MODEL_*、私有目录；组装所有基础设施 |
| `apps/api/server/session-cookie.ts`                                                  | Node crypto / Buffer；AES-256-GCM session sealing；8 小时有效期，HttpOnly、SameSite=strict、生产 Secure  |
| `apps/api/server/request.ts`                                                         | Node request id；cookie/bearer 认证、Origin 检查、body limit、database/provider error mapping            |
| `packages/database/src/{connection,repositories,attachment-repository,api-token}.ts` | pg Pool、SQL、transaction、token hashing；DB 凭据不得进入浏览器                                          |
| `packages/database/src/{migrations,seed}.ts`、`src/cli/*.ts`                         | Node fs/crypto、运维环境读取；离线管理入口，不属于 SPA                                                   |
| `packages/storage/src/local-attachment-storage.ts`                                   | Node fs/path/crypto、私有 storage locator、流式文件读写和 checksum                                       |
| `packages/storage/src/media-inspector.server.ts`                                     | Node Buffer、服务器 header inspector；通过 `@cce/storage/media-server` 接入                              |
| `packages/model-provider/src/{configuration,openai-compatible-provider}.ts`          | 模型 endpoint/API key、服务端远程调用；只能通过 ModelProvider port 接入应用                              |
| `packages/application/src/conversation-import-service.ts`                            | Node crypto；导入编排、evidence transaction，不可整体打包到 Vue                                          |
| `packages/application/src/extraction-service.ts`                                     | 服务端模型编排与 `process.env.NODE_ENV` 分支；不是浏览器服务                                             |
| `packages/conversation-import/src/{provider-submission,chatgpt}.ts`                  | Buffer 字节预算与 capture normalization；非 UI 运行模块                                                  |
| `packages/mcp-server/src/index.ts`                                                   | MCP SDK、带 actor 的服务调用；在 API runtime 挂载                                                        |
| `apps/web/server/vue-shell.ts`、`scripts/*.mjs` 中构建/启动脚本                      | Node filesystem/process；区分静态宿主和工具链，不能搬进 Vue src                                          |
| `plugins/cce-conversation-submission/scripts/cce-auth-headers.mjs`                   | 本地客户端 Node fs 与 Bearer 凭据读取；既不是浏览器代码，也不需要转移到 API server                       |
| `packages/test-support/src/primitives.ts`                                            | Node crypto 测试设施，不是产品 runtime                                                                   |

`apps/web/server/{runtime,session-cookie,attachment-content}.ts` 主要是到 API 的兼容重导出；`queries.ts` 已重导出 application 的 `project-queries.ts`。不应误判为还有两份需要独立维护的业务实现。

浏览器边界由 [build/browser-boundary.ts](../apps/vue/build/browser-boundary.ts)、[边界单测](../tests/unit/media-browser-boundary.test.ts) 和 [bundle audit](../scripts/audit-browser-bundles.mjs) 支持。Vue 继续只使用 browser-safe DTO/schema 和自身浏览器代码；构建插件使用 Node 并不代表 Node 进入浏览器产物。禁止通过 Vue import `apps/api`、application runtime、database、storage、provider 或 MCP package 来实现所谓解耦。

## Target topology

```text
Browser
  -> static host / same-origin gateway -> Vue SPA
  Vue SPA
    -> /api/* -> standalone CCE API (Node.js 24)
                  -> HTTP handlers + auth/session + composition root
                    -> application / domain / context-engine / agents
                    -> adapters: PostgreSQL / private storage / ModelProvider

Plugin / MCP client
  -> /mcp -> standalone CCE API
               -> existing MCP facade + shared auth/application services
                 -> adapters -> PostgreSQL

Next.js: absent from the target runtime dependency graph
         source may remain in the repository for migration history/rollback
```

建议保留公共同源 `/api/*` 和 `/mcp`，让网关把它们直达独立 API，SPA fallback 仅处理页面路径。这样现有 relative URL、cookie、原生 video、下载链接无需改成跨域协议；独立部署服务不等于必须让浏览器跨域访问。网关须正确传递/验证 public authority 与 scheme，使 Origin/CSRF 校验继续有效，不能无条件信任 forwarded headers。

迁移只替换 HTTP host、路由挂载与部署装配。以下约束不变：

- PostgreSQL 是 source of truth；不做数据库 migration，不改变 domain semantics。
- Evidence → Proposal → Review → Commit 保持；Conversation/Message 继续是 evidence。语义状态变化产生 immutable ContextCommit，保留 Project → Commit → Conversation → Message → actor provenance。
- 高风险变更继续由 AI 提案、授权人审核提交；RBAC、project scope、append-only history、幂等与并发 HEAD 检查留在 application/database。
- 浏览器不读取 DB、storage secret、session secret 或 model API key；server-only 代码不得移到 Vue。
- Next 源码本 scope 不删除；目标服务的 listener、静态文件和 API routing 均不得经过 Next。

## Follow-up migration file inventory

“复用/核对”不意味着必须改动该文件；“新增建议”是后续工作，不是当前已有实现。本次仅产出审计文档，不修改下列代码或 lockfile。

| Category   | Files                                                                                                                                                                                                          | Follow-up work                                                                                                          |
| ---------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| API        | `apps/api/package.json`、`apps/api/server.ts`、`apps/api/router.ts`（新增建议）；`apps/api/tsconfig.json`                                                                                                      | 独立 deployable package、Node listener、Request/Response 与流适配、method/path/params routing、关闭连接与 pool 生命周期 |
| API        | `apps/api/handlers/**/route.ts`、`apps/api/server/{runtime,services,request}.ts`                                                                                                                               | 复用现有通用 handlers/services；由新 host 初始化，不通过 getWebRuntime                                                  |
| API        | `apps/api/route-inventory.json`、`apps/web/app/api/**/route.ts`                                                                                                                                                | 修正缺失 GET；以上 34 路径/45 methods 为 parity 基线，核对 404/405/HEAD/OPTIONS；旧 wrappers 保留但退出目标运行图       |
| API        | `apps/api/handlers/http-contract.test.ts`、`apps/api/server/request.test.ts`、`tests/integration/database.test.ts`                                                                                             | 为新 listener 验证真实 HTTP dispatch、错误响应、流取消和 PG 行为；原有 wrapper parity 可作为过渡测试                    |
| auth       | `apps/api/server/{request,session-cookie}.ts`、`apps/api/handlers/session/route.ts`                                                                                                                            | 延续 Bearer 优先级、cookie codec、CSRF Origin、Secure/HttpOnly/SameSite 和注销语义                                      |
| auth       | `apps/web/server/{request,session-cookie}.ts`、`packages/application/src/session-service.ts`、`packages/database/src/api-token.ts`                                                                             | 去掉新 host 对 Next wrapper 的依赖，保留应用认证/token 持久化规则                                                       |
| auth       | `apps/vue/src/data/session.ts`、`apps/vue/src/views/LoginView.vue`、`apps/vue/tests/session.spec.ts`                                                                                                           | 对新 host 验证 bootstrap/login/logout、401、错误 Origin；同源路径可保留                                                 |
| frontend   | `apps/vue/{vite.config.ts,.env.example,README.md}`、`apps/vue/build/api-proxy.ts`                                                                                                                              | proxy target 改到独立 API；明确开发 MCP 是否直连 API；继续维持同源语义                                                  |
| frontend   | `apps/vue/src/{config,router}.ts`、`apps/vue/src/data/{api-client,chat-stream}.ts`、上文 views/components 调用点                                                                                               | 复用 DTO 与路径；核对 base、deep links、SSE，不引入 server imports                                                      |
| frontend   | `apps/web/app/{page.tsx,vue/[[...path]]/route.ts}`、`apps/web/server/vue-shell.ts`、`scripts/stage-vue.mjs`                                                                                                    | 用独立静态服务实现 root redirect、SPA fallback、assets 404/cache；Vue build 不再复制到 Next 才可发布                    |
| frontend   | `apps/vue/build/browser-boundary.ts`、`scripts/audit-browser-bundles.mjs`、`apps/vue/tests/{migration,default-deployment}.spec.ts`                                                                             | 延续 browser import/secret 边界；把部署验证指向无 Next 的服务                                                           |
| media      | `apps/api/handlers/projects/[projectId]/attachments/**/route.ts`、`apps/api/handlers/projects/[projectId]/conversations/[conversationId]/attachments/route.ts`、`apps/api/server/attachment-content.ts`        | 独立 host 接通 raw upload、metadata/list、inspection、content、Range 和 abort                                           |
| media      | `packages/application/src/{attachment-service,attachment-storage,attachment-policy,media-processing-service,media-inspection}.ts`、`packages/storage/src/{local-attachment-storage,media-inspector.server}.ts` | 复用策略/ports/adapters；核对新进程 cwd 与持久卷。开发默认目录依赖 `process.cwd()`，改入口时不能静默换存储位置          |
| media      | `packages/database/src/{attachment-repository,attachment-schema}.ts`、`packages/api-contracts/src/{attachment-contracts,conversation-contracts}.ts`                                                            | 保留元数据/Message association 与脱敏 DTO；不新增 migration，不擅自改成内嵌 attachments DTO                             |
| media      | `apps/vue/src/attachments/*`、`apps/vue/src/views/{ConversationView,AttachmentView}.vue`、`apps/vue/src/components/MessageList.vue`                                                                            | 对新 host 核对数组关联、inspection、Blob/Range/worker/download 与独立 preview 页面                                      |
| media      | `apps/web/server/attachment-routes.test.ts`、`apps/vue/tests/{attachment-lifecycle,multimedia}.spec.ts`、`tests/unit/application/{attachment-service,media-processing-service}.test.ts`                        | 将 HTTP 宿主验收迁到独立 API；保留权限、幂等、range、失败 fallback 覆盖                                                 |
| MCP        | `apps/web/app/mcp/route.ts` → `apps/api/handlers/mcp/route.ts`（新增建议）；`packages/mcp-server/src/index.ts`                                                                                                 | 迁移 auth/body/transport 挂载，注册 GET/POST/DELETE；复用 MCP facade，保持工具语义                                      |
| MCP        | `plugins/cce-conversation-submission/.mcp.json`、`scripts/cce-auth-headers.mjs`（插件目录内）、`skills/submit-cce-conversation/SKILL.md`（插件目录内）                                                         | endpoint 指向独立 API 的可达地址；核对凭据 helper 和 resolve/preview/submit 流程；不把媒体 reference 当 binary upload   |
| MCP        | `packages/mcp-server/src/index.test.ts`、`apps/vue/tests/default-deployment.spec.ts`、`docs/plugins/cce-plugin.md`                                                                                             | 新 host 上认证与工具调用验收，更新安装/endpoint 文档                                                                    |
| deployment | 根 `package.json`、`scripts/dev.mjs`、`scripts/stage-web-runtime.mjs`、`Dockerfile`、`.dockerignore`                                                                                                           | build/dev/start 与镜像运行入口切换，Vue 与 API 产物独立；退出 `.next/standalone` 依赖                                   |
| deployment | `.env.example`、`scripts/load-root-environment.mts`、`compose.yaml`、`apps/web/next.config.ts`                                                                                                                 | 环境加载、私有 storage volume、health、反向代理与 CSP/HSTS 等迁往合适宿主；PG source of truth 不变                      |
| deployment | `playwright.config.ts`、`apps/vue/playwright*.config.ts`、`scripts/run-postgres-tests.mts`、`.github/workflows/ci.yml`、`tsconfig*.json`、`eslint.config.mjs`                                                  | CI/E2E 以新服务启动并验证；保留 strict TS、Node 24、pnpm 11 和依赖方向 gate                                             |
| deployment | `README.md`、`docs/{architecture,api-contracts,security,testing,deployment}.md`、`docs/adr/0009-browser-api-boundary-and-vue-migration.md`                                                                     | 更新最终 topology/操作指南；区分历史阶段文档与实际完成状态                                                              |

后续迁移完成的关键证据应是：**不启动 Next，Vue 页面与全部 REST/SSE、session、附件预览和 MCP 仍能通过独立 API 完成既有流程**；并通过适用的格式、lint、typecheck、单测/coverage、真实 PostgreSQL integration、E2E 与 production build。不能以移出文件目录或 Vue build 成功替代这个运行时验收。
