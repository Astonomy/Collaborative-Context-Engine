# S12：standalone attachment、media、MCP 与 Submit Plugin 验证

验证日期：2026-10-09（Asia/Shanghai）。

真实 PostgreSQL、磁盘存储、standalone HTTP、MCP SDK client 和 Plugin 上传脚本之间的端到端链路通过。最终 PostgreSQL 集成测试 **3 files / 31 tests**，standalone Chromium 回归 **5 tests**。WebM 原生媒体预览当前不支持；content endpoint 的 403 没有可达业务场景；全仓格式门禁仍失败。不能据此宣称全部验收项或完整 Definition of Done 已通过。

## 环境、执行和隔离

- Node.js 24.15.0，pnpm 11.22.0，使用 S10 现有 WSL PostgreSQL 18.6 实例。首次连接失败时启动已有 `collaborative-context-engine-postgres-1`，未修改 Docker/nginx。
- 现有 runner 创建随机 `cce_test_<uuid>` 库；MCP suite 再创建自己的随机空库，执行六个迁移。独立库解决 suite 顺序影响空库迁移断言的问题。关闭 HTTP、MCP clients、连接池后删除测试库和临时附件目录。
- 集成测试只启动 `createStandaloneServer(createApiRouter(...))`，监听随机 loopback 端口；`/mcp` 和 `/api/projects/.../attachments/.../content` 同属该 standalone API。
- 浏览器测试使用 `pnpm test:e2e:standalone`：现有配置启动 Vue Vite :5173 和 standalone API :3001，Vite 将 `/api` 转发到 :3001。没有启动 Next。测试前后检查 :3000 无监听，未发现运行中的 `next dev`、`next start`、`next-server` Node 进程。
- 默认 `pnpm test:e2e` 配置会启动 `dev:legacy` / `start:legacy`，因此本次不执行，使用 standalone E2E 替代。类型检查和单元测试涉及已有 legacy 文件，不代表启动或调用 Next 服务。

## Part A：真实附件与持久化

每个支持类型均执行：本地文件 → Plugin 子进程读取并上传真实 bytes → PostgreSQL `import_attachment_uploads` staging → 返回真实 UUID → 原消息 `attachmentIds` → MCP preview → submit → `attachments JOIN messages` 验证 project/conversation/message 关联 → HTTP conversation 和 messages DTO 重读 → 授权 content 下载并逐字节比较。

| 文件类型                  | 上传与提交                                                                               | PostgreSQL / 重读                                                | Content-Type / 内容                                   | 结果                   |
| ------------------------- | ---------------------------------------------------------------------------------------- | ---------------------------------------------------------------- | ----------------------------------------------------- | ---------------------- |
| PNG `pixel.png`           | 实际 PNG bytes 经 Plugin 上传，MCP 提交成功                                              | conversation 和 message `attachments[]` 含相同 ID，SQL join 一条 | `image/png`，200 下载 bytes 相等                      | 通过                   |
| JPEG `preview.jpg`        | 使用仓库可解码 JPEG 文件，经 Plugin 上传与 MCP 提交                                      | staging、消息关联、两个 DTO 重读通过                             | `image/jpeg`，完整内容相等                            | 通过                   |
| MP4 `preview.mp4`         | 使用仓库可播放 MP4 文件，经 Plugin 上传与 MCP 提交                                       | staging、消息关联、两个 DTO 重读通过                             | `video/mp4`，完整内容相等                             | 通过                   |
| 普通二进制 `original.bin` | `[0,255,128,1,7]` 实际 bytes，经 Plugin 上传与 MCP 提交                                  | staging、消息关联、两个 DTO 重读通过                             | `application/octet-stream`，完整内容相等              | 通过                   |
| WebM                      | EBML header fixture 以 `video/webm` 上传 → 422；以 `application/octet-stream` 上传 → 201 | generic staging 接受；没有执行 WebM 视频解码或完整电影文件提交   | 当前签名白名单不识别 WebM；不提供 `video/webm` inline | 原生支持不适用，未实现 |
| 32 MiB `large.bin`        | 分块 ReadableStream 经真实 HTTP conversation upload → 201                                | PostgreSQL attachment repository 重读通过                        | HTTP 200 分块消费，全长和 SHA-256 相等                | 通过                   |

staging 不建立 Message；submit 才绑定原消息。旧用例继续验证同 uploadId/相同文件返回同 ID，改变 bytes 后重用 uploadId 失败，提交中后续 attachment 冲突会回滚先前 binding 和新 Conversation，不能残留半提交。

## Part B：媒体预览、Range 与鉴权

现有 Chromium attachment lifecycle / multimedia 用例实测 PNG、JPEG `naturalWidth=1`，MP4 `readyState >= 2`，页面 reload 后可显示。使用真实授权 content endpoint，而非文件名占位或 data URL 替代服务端附件。

| HTTP 状态 | 请求与断言                                                                                                           | 结果                                            |
| --------- | -------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------- |
| 200       | 四个支持类型完整下载；真实 bytes 相等；32 MiB 流式校验；viewer 成员可读                                              | 通过                                            |
| 206       | 四个支持类型分别测试 `bytes=0-3`、`bytes=-4`、`bytes=4-`，逐段 bytes 相等；浏览器 MP4 Range 可用                     | 通过                                            |
| 401       | 无凭证、invalid bearer 下载；浏览器退出后无 cookie 下载                                                              | 通过                                            |
| 403       | viewer 向 import attachment upload 写入 → 403；viewer MCP preview/submit → tool error                                | 权限不足写入通过；**content GET 的 403 未覆盖** |
| 404       | 随机 attachmentId；同一 owner 的另一个项目路径使用原 attachmentId；有效非成员 token + Range；跨 conversation/project | 通过，无越权读取                                |
| 416       | 越过文件末尾、反向区间、多 Range、零长度 suffix、非法 Range 文本                                                     | 通过，符合现有单区间协议                        |

content GET 用 `project:read` 授权，所有现有项目成员角色均可读；非成员、跨项目资源以 404 防枚举。当前不存在“成员有效但无 read 权限”的角色，所以不制造 GET 403 或修改既有 RBAC。本次观测到的 403 属于上传写入端点，不能替代 content GET 的 403 证明。

| Header         | 完整 200                                                | 部分 206                   | 不合法 416         |
| -------------- | ------------------------------------------------------- | -------------------------- | ------------------ |
| Content-Type   | 验证为检测出的 PNG/JPEG/MP4 MIME，普通文件 octet-stream | 与完整内容相同             | 现有 JSON 错误响应 |
| Content-Length | 实际 byteSize                                           | end-start+1                | 未作为媒体长度断言 |
| Content-Range  | 无                                                      | `bytes start-end/byteSize` | `bytes */byteSize` |
| Accept-Ranges  | `bytes`                                                 | `bytes`                    | `bytes`            |

大文件验证保留 `AttachmentStorage` port 和真实 `LocalAttachmentStorage`。32 MiB HTTP 上传与下载均按块消费，不使用 arrayBuffer 聚合大文件；完整内容以增量 hash 校验。storage 单元测试验证 open 后尚未 read、首次 next 只读 64 KiB、取消后关闭文件且不再 I/O；集成测试遍历全部 storage chunks，均不超过 64 KiB。实现路径仍为磁盘按位置读取 → async iterator → ReadableStream → Node pipeline/backpressure，没有全文件读取。未进行进程 RSS 压测或多用户吞吐压测。

Plugin helper 当前对本地文件使用 `readFile`，最多 100 MiB，客户端会持有完整上传文件；上述服务端 streaming 证明不包含 Plugin 客户端恒定内存声明。

## Part C：standalone MCP

| 项目                 | 验证结果                                                                                                                         |
| -------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| transport 独立启动   | SDK StreamableHTTPClientTransport 连接 standalone `/mcp`，真实初始化与 callTool 成功                                             |
| token authentication | PostgreSQL seed 的随机 token 通过 HTTP Authorization；身份由服务端确定                                                           |
| invalid token        | SDK connect 拒绝；`GET/POST/DELETE /mcp` 均 401                                                                                  |
| preview              | 文本和每个支持文件类型成功；preview 前后会话数量相同                                                                             |
| submit               | 返回真实 importId、conversationId；消息与附件重新读取成功                                                                        |
| unauthorized project | 非成员 project preview → isError；attachment upload → 404；viewer preview/submit → isError                                       |
| idempotency          | 相同 preview 重提返回原 import/conversation；相同文本再 preview/submit 返回原结果；二进制 upload retry 同 ID，重复 submit 同结果 |
| 项目状态             | 文本提交测试确认 HEAD 不移动，原消息和 import createdBy provenance 保留；没有修改 Proposal Workflow                              |

## Part D/E：Submit Plugin 和 Next 回归

- 本次调用仓库 Plugin 的真实 Node 上传脚本作为子进程，使用授权 capture JSON 的 `localAttachments` 文件路径读取 bytes。随机凭证只通过子进程环境和 HTTP header 传入，没有写入 capture、原消息、stdout、prompt 或 skill。
- helper stdout 不含本地 path 或 token；保留原文本并增加真正 attachmentIds。纯文本 `Attachment: evidence.bin` 经 MCP 提交和重读后 `attachments=[]`，文件名不能建立关联。
- scripts 没有 provider DOM、cookies、浏览器抓取依赖；skill 明确限制当前授权 invocation、禁止读取 provider 历史和本地 transcript。静态边界测试检查上传/认证脚本无浏览器 DOM、cookies、localhost:3000 请求路径。
- Plugin `.mcp.json` 默认准确指向 `http://localhost:3001/mcp`，上传 helper 默认 `http://localhost:3001`，已有 Plugin 单元测试断言实际 fetch URL 的 host/port 和 binary body。
- TypeScript source graph 测试从 `apps/api/main.ts` 遍历实际传递依赖，确认包含 MCP handler 和 content handler，且没有 `apps/web` source、`next` 或 `@cce/web` import。集成 suite 对 `next/server` 设为加载即抛错，仍全部通过。
- 未模拟真实 ChatGPT/Codex 宿主 UI 的 skill invocation/确认按钮；本报告证明仓库 Plugin helper + 标准 MCP client 的真实服务链路。未调用外部 provider DOM/cookies。

## 回归与质量检查

| 命令                                                                                                                          | 结果                                                                                                                                                                                         |
| ----------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm test:integration`                                                                                                       | 通过，3 files / 31 tests，含 MCP/media/plugin 10 tests；空库迁移通过                                                                                                                         |
| `pnpm test:e2e:standalone`                                                                                                    | 通过，5 Chromium tests，含实际媒体显示、Range、reload、鉴权                                                                                                                                  |
| `pnpm exec vitest run tests/unit/standalone-media-mcp-boundary.test.ts packages/storage/src/local-attachment-storage.test.ts` | 通过，2 files / 8 tests                                                                                                                                                                      |
| `pnpm exec tsc -p tests/integration/tsconfig.json --noEmit --pretty false`                                                    | 通过                                                                                                                                                                                         |
| `pnpm test:coverage`                                                                                                          | 通过，root 527 tests、Vue 142 tests、Plugin 4 tests；root statements 91.64%、branches 84.56%、functions 96.15%、lines 92.27%，阈值通过；随后新增的两个 source/Plugin boundary tests 单独通过 |
| `pnpm build`                                                                                                                  | 通过，standalone API + 当前 frontend production build                                                                                                                                        |
| `pnpm lint`                                                                                                                   | 通过                                                                                                                                                                                         |
| `pnpm test`                                                                                                                   | 通过，root 529、Vue 142、Plugin 4 tests                                                                                                                                                      |
| `pnpm format:check`                                                                                                           | 失败，59 个非本次编辑文件格式问题                                                                                                                                                            |
| `pnpm validate`                                                                                                               | 失败，停在相同 format:check 问题                                                                                                                                                             |

`pnpm typecheck` 最终通过。首轮发现根配置的 DOM RequestInit 不含 Node duplex；改为明确的 `RequestInit & { duplex: "half" }`，不使用类型断言。最终 integration 专用 tsc 也通过，本次四个修改文件的格式检查通过。

## 失败处理和仍未通过的项目

1. 首次 `ECONNREFUSED`：现有 PostgreSQL 容器已停止；启动后真实测试成功。
2. 扩展 suite 初稿触发旧文本用例“零会话”假设：改为比较 preview 前后数量；未削弱 preview 不创建 Conversation 的断言。
3. MCP suite 先迁移共享库导致 empty-database 测试 `already_applied`：MCP suite 改用独立空随机库，完整 integration 恢复通过。
4. 初稿 lint/typecheck 报 iterator any、unbound method、duplex 类型：使用 done 分支缩窄、显式回调和 RequestInit 类型修正，相关检查通过。
5. **仍未通过**：全仓 format/validate；WebM 原生视频预览无支持；content GET 403 无可达现有权限场景；真实宿主 Plugin UI invocation 未执行。没有跳过现有测试，也没有以 SQLite、mock database 或 placeholder success 替代这些缺口。

本次仅扩展 `tests/integration/standalone-mcp.test.ts`、新增 `tests/unit/standalone-media-mcp-boundary.test.ts`、补充 `packages/storage/src/local-attachment-storage.test.ts` 并生成此报告。没有发现必须修改生产实现的媒体/MCP业务缺陷；未修改 Vue UI、核心 Proposal Workflow、Docker/nginx 或 legacy Next。工作区原有修改保留。
