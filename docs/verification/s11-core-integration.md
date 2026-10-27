# S11：standalone API 核心 PostgreSQL 集成验证

验证日期：2026-10-08（Asia/Shanghai）。

结论：真实 standalone HTTP → server runtime → application → PostgreSQL 链路通过。
`pnpm test:integration` 最终为 **3 个文件、24 个用例全部通过**，其中新增核心 REST
集成测试 9 个用例。相关 API 测试 52 个通过，standalone 浏览器 E2E 5 个通过。
没有发现需要修改生产代码的业务缺陷。全仓质量门禁尚未全绿：已有 59 个文件的格式
问题使 `pnpm format:check` 和 `pnpm validate` 失败。

## 执行方式与持久化边界

- 使用现有 WSL Docker PostgreSQL `18.6` 实例；不修改 Docker/nginx 配置。
- 现有测试 runner 使用 `/postgres` maintenance 连接创建随机 `cce_test_<uuid>` 数据库，
  并在测试结束后清理。新增 REST suite 同样创建独立随机数据库，验证连接名后才执行，
  关闭连接池后删除数据库。临时附件目录也在 teardown 清理。
- 新 REST suite 从空 PostgreSQL 数据库执行现有六个迁移。独立数据库避免新增 suite
  先迁移共享数据库后，影响原有“首次迁移必须 applied”的断言；没有放宽原断言。
- HTTP 使用真实 Node listener、`createStandaloneServer`、`createApiRouter` 和 `fetch`。
  runtime 使用真实 `PostgresUnitOfWork`，没有 mocked repository。
- 模型使用本地可控 HTTP completion fixture，经现有 `QwenVllmModelProvider` / `ModelProvider`
  抽象调用。fixture 提供正常高风险 decision、非法 schema、伪造可信字段、503 四种响应。
- 数据库校验包括 repository 重读、SQL 检查失败 ModelRun/Delta、数据库 immutable trigger。
  消息还通过新建 runtime、独立连接池和新的 HTTP listener 重读，排除原 runtime 内存状态。
- session 创建是现有加密 cookie 机制；没有 PostgreSQL session 表。每次认证使用 PostgreSQL
  中的 token hash 查找身份，每次项目操作重新读取 membership。未把 cookie 描述为数据库 session 记录。

## 测试矩阵与具体结果

下表核心用例来自 `tests/integration/standalone-core.test.ts`。预期拒绝请求也是通过用例。

| 业务                      | 实际验证与断言                                                                                                                                                                                                                                                 | 结果 |
| ------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---- |
| Authentication            | login 返回用户和加密 cookie；cookie GET session 成功；不存在的合法格式 token → 401；无凭证 → 401；logout 设置 Max-Age=0；移除 cookie 后 → 401；过期 cookie → 401                                                                                               | 通过 |
| Session 撤销              | 在隔离数据库删除测试身份的 backing API token；先前创建的 cookie 和 bearer token 均 → 401                                                                                                                                                                       | 通过 |
| Projects                  | HTTP create/list/get；创建者 membership 为 owner；HTTP 添加 editor、成员改为 viewer；viewer 写 conversation 和管理成员 → 403                                                                                                                                   | 通过 |
| Conversations             | HTTP create/list/get；返回持久化 conversation；另一项目路径配同一 conversation ID，messages/extract 均 → 404                                                                                                                                                   | 通过 |
| Messages                  | persist/read；两个相同 clientMessageId 并发请求返回同一 message ID；另两个不同请求并发写入；重读 sequence 为 1,2,3,4；新 runtime HTTP 重读相同记录；author 为服务端 human/userId；伪造 role/actor body → 400                                                   | 通过 |
| Extraction                | evidence 经模型抽取为持久化 ContextDelta；提案由 repository 重读相等；提案生成与 preview 不移动 HEAD                                                                                                                                                           | 通过 |
| Extraction 错误           | 非法 schema → 422；模型伪造 actor/authority → 422；模型 503 → API 503；三条 failed ModelRun 持久化；零 ContextDelta；HEAD 未变                                                                                                                                 | 通过 |
| Proposal Workflow         | extraction → merge request → GET preview → PUT resolution → finalize；未 review → 409；editor 审批高风险 decision → 403；owner 审批成功；commit 的 committedBy 为认证 owner                                                                                    | 通过 |
| Evidence provenance       | commit afterVersion 保存 projectId、conversationId、原 messageIds、服务端建立的模型 actor；原 message 保存 human author；ContextItemVersion.commitId 与持久化 snapshot 保留完整关联                                                                            | 通过 |
| Immutable commit          | 直接 SQL UPDATE summary 与 DELETE commit 都被 PostgreSQL 拒绝；原有数据库 suite 同时验证快照、CAS、跨 conversation provenance 约束与回滚                                                                                                                       | 通过 |
| Concurrency / Idempotency | 缺 Idempotency-Key → 400；错误 expectedHeadCommitId → 409；同 key 并发 finalize 返回同一 commit；提交后换 key → 409；两份已审批提案竞争同一 HEAD，仅一份 200、另一份 stale 409，项目 version 只增加 1                                                          | 通过 |
| Agents                    | HTTP start → awaiting_approval；GET persisted run；editor resume approve → 403；owner approve → completed，proposal 入库；另一 run cancel → cancelled；模型 503 生成 persisted failed run、proposal=null；list 重读三个终态；所有 agent 操作不直接提交 Context | 通过 |
| Security                  | projects/conversations/messages/extract/merge creation/agent creation 的无凭证请求 → 401；旧 cookie 在 editor 降为 viewer 后，即使带 x-cce-role: owner 仍 → 403；membership 撤销后 → 404；服务端不信任客户端或模型的角色和 actor                               | 通过 |

授权状态码沿用现有防枚举契约：**已知项目的成员权限不足 → 403；非成员或跨项目资源 → 404**。
本次没有将非成员的 404 改成 403。

## 失败、根因与处理

| 阶段             | 具体失败                                                                       | 根因                                                                                     | 处理及回归                                                               |
| ---------------- | ------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| 首次 integration | `ECONNREFUSED ::1:5432 / 127.0.0.1:5432`                                       | 配置对应的 WSL PostgreSQL container 停止                                                 | 启动已有实例，保持 WSL 生命周期；原有 15 个用例通过                      |
| 环境恢复过程中   | `terminating connection due to administrator command`，随后再次拒绝连接        | WSL 未持续运行，数据库连接在执行中被终止                                                 | 保持 WSL 活跃后完成后续 PostgreSQL suites；未修改业务代码                |
| 新测试初稿       | member response schema、PUT/POST、400/422、provenance actor 断言不符合既有契约 | 测试初稿的预期错误；模型提案 actor 与证据 message 的 human author 是不同 provenance 节点 | 对齐现有 runtime/contracts；保留模型提案身份和人类 commit 身份的独立断言 |
| suite 顺序       | 原有空数据库迁移测试收到 `already_applied` 而不是 `applied`                    | 新增 suite 先迁移 runner 的共享数据库                                                    | 新 suite 改用自己的空随机数据库；原有首次迁移断言保持不变                |
| 格式门禁         | `Code style issues found in 59 files`                                          | 本次未编辑的仓库文件存在格式问题                                                         | 只格式化新增测试和报告；不批量修改既有文件；validate 仍失败              |

最终业务测试没有未解决失败，没有跳过测试，也没有通过 mocked database 或 placeholder success 规避失败。

## 修改文件

| 文件                                        | 修改                                                                                            |
| ------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| `tests/integration/standalone-core.test.ts` | 新增 9 个真实 HTTP/PostgreSQL 核心业务与错误路径用例、受控模型 HTTP fixture、独立数据库生命周期 |
| `docs/verification/s11-core-integration.md` | 本验证报告                                                                                      |

生产代码、迁移、依赖均无需改动。未修改 apps/vue、Docker/nginx、Next.js legacy、MCP/plugin。
既有工作区改动不属于本次修改。

## 回归与质量检查

| 命令                                                                          | 结果                                                                                                                                       |
| ----------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `pnpm test:integration`                                                       | 通过：3 files，24 tests；最终执行 21:50:54，8.55s                                                                                          |
| `pnpm exec vitest run apps/api tests/unit/server-runtime.test.ts`             | 通过：7 files，52 tests                                                                                                                    |
| `pnpm test:e2e:standalone`                                                    | 通过：5 Chromium tests；含 evidence → owner review → canonical commit、真实 cookie login/reload/logout、PostgreSQL 附件链路                |
| `pnpm exec tsc -p tests/integration/tsconfig.json --noEmit --pretty false`    | 通过                                                                                                                                       |
| `pnpm exec eslint tests/integration/standalone-core.test.ts --max-warnings 0` | 通过                                                                                                                                       |
| `pnpm lint`                                                                   | 通过                                                                                                                                       |
| `pnpm typecheck`                                                              | 通过                                                                                                                                       |
| `pnpm test:coverage`                                                          | 通过：root 526 tests、Vue 142 tests、plugin 4 tests；root statements 91.64%、branches 84.51%、functions 96.15%、lines 92.27%，配置阈值通过 |
| `pnpm build`                                                                  | 通过：standalone API 与当前 frontend production build                                                                                      |
| `pnpm format:check`                                                           | 失败：既有 59 个文件格式问题；新增文件单独格式检查通过                                                                                     |
| `pnpm validate`                                                               | 失败：在 format:check 阶段停止；其 lint/typecheck/coverage/build 分别独立运行并通过                                                        |

## 仍存在的风险与验证边界

1. **Logout 不能使已复制 cookie 立即失效。** 实测 DELETE session 清除浏览器 cookie，
   但手动重放之前的 cookie 仍返回 200。现有会话为八小时有效期的 stateless 加密 token，
   没有单会话撤销记录。token 撤销 → 401、membership 降权 → 403 已验证；如要求 logout
   立即撤销所有重放，需要后续明确会话语义与持久化设计。
2. **非成员返回 404。** 当前符合既有防枚举契约；如果“unauthorized → 403”要求所有
   非成员也返回 403，需要单独统一 API 安全契约。当前成员权限不足确实返回 403。
3. **PostgreSQL driver 提示同 client 并行 query 将在 pg 9 移除。** 当前 pg 8 下通过；
   本次没有改变已有 transaction 内 Promise.all 查询。升级驱动时需要处理此兼容性问题。
4. 模型 fixture 验证了真实 provider HTTP/schema/error 链路，不证明真实外部模型的提案质量。
   Agent cancellation 覆盖 awaiting_approval → cancelled；不包含进程崩溃恢复和执行中跨进程取消。
   并发测试使用一个 API 服务和真实 PostgreSQL，并不构成多副本压测。
5. 全仓格式问题仍阻止完整 `pnpm validate` 成功；该失败不能被业务测试通过替代。
