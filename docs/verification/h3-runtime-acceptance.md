# H3 runtime acceptance

执行日期：2026-10-16（Asia/Shanghai）。结论：**验收阻塞，未通过**。H2 的 build/typecheck 通过不能替代本轮运行结果。

## 环境与隔离

- Windows Node 24.15.0、pnpm 11.22.0；在恢复后的当前工作区执行，保留已有用户改动。
- 原配置的 localhost:5432 无监听，首次 integration 在连接阶段退出 1，未发现或运行测试。
- 使用 WSL Docker 新建专用容器 `cce-h3-postgres-20261016`，镜像 `postgres:18.6-alpine3.24`，容器 ID 前缀 `9b710a9db134`。宿主端点 `172.30.135.36:55439`，维护库 `postgres`。
- 仅对子进程覆盖 `TEST_DATABASE_URL`，未修改 `.env`，未连接开发库 `cce`。runner 为每次执行创建 `cce_test_<32位随机值>` 空库，integration 的 core/MCP suite 另建各自隔离库；附件目录为临时目录。
- PostgreSQL 实际返回 `PostgreSQL 18.6 on x86_64-pc-linux-musl`；证据见 [database.txt](../../agent/log/h3-logs/database.txt) 和 [postgres.log](../../agent/log/h3-logs/postgres.log)。不是 SQLite 或假的 repository。
- 首次容器尝试因 WSL 生命周期结束而收到 fast shutdown，integration 退出 1，未获得测试汇总；保持 WSL 会话后重新执行，得到下表可重复的迁移错误。没有把该基础设施失败计作测试通过。
- standalone 配置启动 `pnpm dev:standalone`，Vue 地址为 `http://127.0.0.1:5173/vue/`，decoupling 继承相同配置。执行前后检查未发现 :3000 监听；本轮因迁移失败未到 API/Vue 启动或浏览器请求阶段。

## 三组命令结果

| 命令                       |               测试数量 | 通过 | 测试体失败 | 未执行 | suite/初始化失败                       | 退出码 |
| -------------------------- | ---------------------: | ---: | ---------: | -----: | -------------------------------------- | -----: |
| `pnpm test:integration`    |          31（3 files） |    0 |          0 |     31 | 3 suites 的 beforeAll 迁移失败         |      1 |
| `pnpm test:e2e:standalone` | 5（静态收集，3 files） |    0 |          0 |      5 | runner 空库迁移失败，Playwright 未启动 |      1 |
| `pnpm test:e2e:decoupling` | 5（静态收集，3 files） |    0 |          0 |      5 | runner 空库迁移失败，Playwright 未启动 |      1 |

integration 细分：database 12、standalone-core 9、standalone-mcp 10。Vitest 输出 `3 failed` files、`31 skipped` tests：这是 beforeAll 失败导致测试体无法执行，没有添加 skip 或过滤失败用例。E2E 数量通过各自配置的 `playwright test --list` 获取（两次退出 0），不代表运行通过；两组当前收集的是相同的 5 个测试。

完整命令日志：[integration](../../agent/log/h3-logs/h3-integration.log)、[standalone](../../agent/log/h3-logs/h3-standalone.log)、[decoupling](../../agent/log/h3-logs/h3-decoupling.log)。三组共享以下真实数据库阻塞，均无业务测试通过证据。

## 空库迁移阻塞

PostgreSQL 服务端记录失败语句：

```sql
CREATE TABLE import_attachment_uploads (
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE RESTRICT,
  ...
);
```

错误为 `column "id" referenced in foreign key constraint does not exist`，SQLSTATE `42703`。来源是 `packages/database/migrations/0006_import_attachment_uploads.sql:2`；`0001_initial.sql:43` 实际定义 `projects.project_id` 为主键，没有 `projects.id`。

调用位置是 `packages/database/src/migrations.ts:91`；两个 E2E runner 在 `scripts/run-postgres-tests.mts:46` 失败。migration 执行使用同一事务，失败回滚，不能把前五个迁移语句已经执行解释为完整迁移通过。服务端日志直接证明错误发生在真实 PostgreSQL，而非前端或模拟 repository。

本轮按验收任务记录源码缺陷，未修改迁移、生产代码、测试断言或 fixture 来绕过错误。没有通过手工建兼容列、预置旧库或改 migration ledger 放行。

## 验收项覆盖与本轮状态

| 验收项                                                | 对应现有测试                                                | 本轮结果                                                            |
| ----------------------------------------------------- | ----------------------------------------------------------- | ------------------------------------------------------------------- |
| 1. 空库创建和 migration                               | runner、database suite                                      | 随机空库创建成功；0006 迁移失败                                     |
| 2. 登录、Session、RBAC                                | standalone-core、session、persisted-journeys                | 初始化阻塞，未执行                                                  |
| 3. Project / Conversation / Message 持久化            | database、standalone-core、persisted-journeys               | 初始化阻塞，未执行                                                  |
| 4. Evidence → Extraction → Proposal → Review → Commit | standalone-core、persisted-journeys                         | 初始化阻塞，未执行                                                  |
| 5. Agent 创建、完成和持久化                           | standalone-core、persisted-journeys                         | 初始化阻塞，未执行                                                  |
| 6. SSE streaming 和 cancellation                      | persisted-journeys 检查 chat SSE 完成；core 检查 Agent 取消 | 初始化阻塞；现有指定组未提供 chat SSE cancellation 的完整浏览器验收 |
| 7. 图片/视频真实二进制上传                            | attachment-lifecycle、standalone-mcp                        | 初始化阻塞，未执行                                                  |
| 8. Message attachments[] 关联                         | attachment-lifecycle、standalone-mcp、database              | 初始化阻塞，未执行                                                  |
| 9. 图片预览、视频 Range                               | attachment-lifecycle、standalone-mcp                        | 初始化阻塞，未执行                                                  |
| 10. MCP preview/submit                                | standalone-mcp                                              | 初始化阻塞，未执行                                                  |
| 11. Submit Plugin 真实文件上传与绑定                  | standalone-mcp 子进程调用真实上传脚本并检查 SQL 关联        | 初始化阻塞，未执行                                                  |
| 12. 页面重载后数据存在                                | session、persisted-journeys、attachment-lifecycle           | 初始化阻塞，未执行                                                  |
| 13. 浏览器请求不得访问 Next.js :3000                  | real-browser 自动 fixture 的请求断言                        | 浏览器未启动，无请求证据，不能判通过                                |

现有模型测试通过本地确定性 HTTP model fixture 接入 ModelProvider，设计上验证 API/数据库链路，不证明外部模型质量。本轮未到模型 fixture 或身份初始化阶段。Agent 刷新用例通过 API 检查持久化结果，不证明 Agent 面板刷新恢复；Agent 取消也不能替代 chat SSE 取消验证。

## 清理与后续条件

runner 的 finally 仅清理自己创建的随机测试库与临时附件目录。WSL 中断留下的本轮测试库随专用容器一同清理；未对开发或生产数据库执行清理。验收结束后移除本轮专用容器及其匿名卷。

下一次验收需要先解决 0006 的外键目标不匹配，再从全新隔离空库重跑上述三组命令；同时补齐 chat SSE cancellation 的隔离测试覆盖。当前不能签收真实 API、Vue、MCP/Media 端到端验收。
