# S14 Vue browser E2E 验收

执行日期：2026-10-15（Asia/Shanghai）。结论：**未通过；环境启动前阻塞，尚无真实浏览器验收成功证据。**

## 真实执行结果

| 命令                                                                  | 结果          | 原因及日志                                                                             |
| --------------------------------------------------------------------- | ------------- | -------------------------------------------------------------------------------------- |
| `pnpm test:e2e:standalone`                                            | exit 1        | pnpm workspace 检查失败；[standalone.log](../../agent/log/s14-logs/standalone.log)     |
| `pnpm test:e2e:decoupling`                                            | exit 1        | 同一 workspace 错误；[decoupling.log](../../agent/log/s14-logs/decoupling.log)         |
| 直接调用 Playwright `--config playwright.decoupling.config.ts --list` | 失败，0 tests | 无法导入 `@cce/api-contracts`；[discovery.log](../../agent/log/s14-logs/discovery.log) |

当前 checkout 的 `packages/agents/package.json`、`packages/api-contracts/package.json` 等已存在用户删除记录；pnpm 仅发现根、Vue、Web 三个 workspace 项目，报 `ERR_PNPM_WORKSPACE_PKG_NOT_FOUND: @cce/agents@workspace:*`。`apps/api` 也未包含可运行的 standalone 入口。未恢复、覆盖这些已有变更。

启动前监听端口检查未发现 3000、5173、3001、5432 监听进程。Next.js 未启动；本次没有启动 legacy 服务。PostgreSQL runner 未进入创建隔离数据库阶段，未产生本次业务数据。

## 测试入口与 Journey

两个配置现在复用 Vue standalone webServer，仅启动 `pnpm dev:standalone`，入口 `/vue/`。standalone 移除了以 `route.fulfill` 提供业务响应的 `migration.spec.ts`、`multimedia.spec.ts`；decoupling 从仅 API 请求测试改为相同真实浏览器测试集。

| Journey | 测试覆盖                                                                             | 本次结果 |
| ------- | ------------------------------------------------------------------------------------ | -------- |
| A       | `session.spec.ts`：UI 登录、项目列表/详情、刷新、退出、会话失效                      | 未运行   |
| B       | `persisted-journeys.spec.ts`：UI 创建会话、发送消息、刷新后读取用户及助手消息        | 未运行   |
| C       | 同上：证据提取、proposal、Owner review、commit、刷新 canonical context               | 未运行   |
| D       | 同上：UI 创建 Agent、显示返回状态，轮询真实 API 到 terminal，刷新后读取持久结果      | 未运行   |
| E       | `attachment-lifecycle.spec.ts`：UI 上传图片、校验 messageId 关联、刷新、实际解码预览 | 未运行   |
| F       | 同上：UI 上传视频、关联、刷新、播放、seek、浏览器 Range 206 和 API Range 字节校验    | 未运行   |
| G       | `persisted-journeys.spec.ts`：独立身份读取私有项目，真实 404 显示到 Vue alert        | 未运行   |
| H       | 同上：读取真实 chat SSE 的四类事件，完成后 UI 解除 busy、刷新无 streaming 残留       | 未运行   |

没有拦截或替换业务 API。沿用现有 runner 的本地确定性 model HTTP server，因此该测试设计验证业务 API/PostgreSQL 及模型端口接入，不验证外部真实模型质量。等待使用响应、可见状态和 `expect.poll`，未加入固定延时。

D 的现有 Vue 实现只在内存中保存当前 Agent result，没有刷新后恢复 Agent 面板的逻辑；本次新增用例在刷新后通过真实 API 读取持久结果，不能证明刷新后 Agent 面板恢复。H 覆盖完成路径，未补取消交互验收。上述能力不能标为完整验收通过。

## 网络验证与失败产物

`real-browser.ts` 自动记录每个测试 browser context 的请求和响应，断言任何浏览器请求 URL 的 port 不为 `3000`，包括页面、资源和后台请求；同时保存 console/pageerror。该断言本次未执行，因此 **没有实际网络请求验证结果**。

失败时配置保存 screenshot、trace（零重试也保留），每个测试附加 `network`、`browser-logs`：

- standalone：`test-results/s14-standalone/`；HTML：`playwright-report/s14-standalone/`。
- decoupling：`test-results/s14-decoupling/`；HTML：`playwright-report/s14-decoupling/`。

本次错误发生在浏览器启动之前，**没有生成 screenshot 或 trace**。实际启动错误日志见上表，不能用历史截图/trace 代替本次证据。

测试数据沿用现有 runner：随机数据库名，空库迁移、独立身份、临时附件目录，在 finally 中 DROP DATABASE、删除临时目录并停止 model server。未修改 PostgreSQL infrastructure、MCP plugin、Docker/nginx 或 Next.js。

## 后续执行条件

对本次文件直接执行 ESLint 同样未能启动检查：现有依赖树缺少 `zod/v4`，由 `eslint-plugin-react-hooks` 加载时报错。新增和修改的测试、配置、本文档使用本地 Prettier 完成格式化；未获得 lint、typecheck、build 或全量质量门通过结果。

先恢复可用的 S10–S12 workspace 源文件及 standalone API 入口，再执行上述两个 pnpm 命令；当前新增测试尚未获得运行验证，不能签收 S14。legacy `test:e2e` 未用作解耦证据。
