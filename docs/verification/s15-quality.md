# S15 standalone 质量门禁

执行日期：2026-10-15（Asia/Shanghai）。本轮完成现存文件的格式修复；完整质量门禁仍未恢复。最终架构状态 **DECOUPLED** 保持不变，本轮不重新签收架构或构建质量。

## 实际失败文件与分类

先执行 `pnpm format:check`，exit 1，pnpm 在启动 Prettier 前因 `ERR_PNPM_WORKSPACE_PKG_NOT_FOUND` 失败：找不到 `@cce/agents@workspace:*`，只发现根、Web、Vue 三个 workspace 项目。随后直接执行现有 `node node_modules/prettier/bin/prettier.cjs --check .`，exit 1，实际发现以下 15 个文件。

| 分类             | 文件                                                          |
| ---------------- | ------------------------------------------------------------- |
| 历史遗留         | `.prettierrc.json`                                            |
| 历史遗留         | `apps/web/components/conversation-panel.test.tsx`             |
| 历史遗留         | `apps/web/components/conversation-panel.tsx`                  |
| 历史遗留         | `apps/web/components/project-sidebar.test.tsx`                |
| 历史遗留         | `apps/web/components/project-sidebar.tsx`                     |
| 迁移验收文档     | `docs/verification/s13-production-deploy.md`                  |
| Generated report | `docs/verification/s8-browser-audit.json`                     |
| 历史遗留         | `scripts/clean.mjs`                                           |
| 历史遗留         | `scripts/report-local-gate.mjs`                               |
| 历史遗留         | `tests/evals/merge-corpus.json`                               |
| 历史遗留         | `tests/evals/merge-corpus.test.ts`                            |
| 历史遗留         | `tests/unit/application/fixtures.ts`                          |
| 历史遗留         | `tests/unit/application/project-conversation-session.test.ts` |
| 历史遗留         | `tests/unit/application/scoped-agent-service.test.ts`         |
| 历史遗留         | `vitest.integration.config.ts`                                |

13 个历史遗留文件在修复前逐字等于 `git show HEAD:<path>`。S13 文档未跟踪，依据内容归为迁移验收文档，无法通过提交历史判断引入时间。审计 JSON 由 `scripts/audit-browser-bundles.mjs` 写出，本轮仅格式化现存报告，没有更新其历史审计结论。实际失败列表没有第三方文件；依赖和构建目录沿用现有 ignore，不新增豁免。

历史 `../../agent/log/legacy-root/.cutover-final-format.log` 记录了 59 个失败文件；当前多个 `packages/*` 源文件和 manifest 已处于删除状态，不能把列表缩短解释为这些文件已修复。未恢复或覆盖已有删除及迁移变更。

## 独立格式修复

仅对上表 15 个文件应用现有 Prettier 配置；配置文件本身仅去掉多余空行，配置取值不变。没有业务逻辑、依赖、架构修改或测试删除，也未修改 lint/format 规则。逐文件验证 `format(before) === format(after)`，15 个均一致。格式变更与本验收文档、日志单独可审阅；没有替用户提交或暂存工作区中已有的大型迁移。

## 修复后真实执行

| 命令                                                    | 结果                                               | 证据                                                                          |
| ------------------------------------------------------- | -------------------------------------------------- | ----------------------------------------------------------------------------- |
| `pnpm lint`                                             | exit 1，workspace 检查失败，ESLint 未启动          | [lint.log](../../agent/log/s15-logs/lint.log)                                 |
| `pnpm typecheck`                                        | exit 1，同上，TypeScript 未启动                    | [typecheck.log](../../agent/log/s15-logs/typecheck.log)                       |
| `pnpm build`                                            | exit 1，同上，未产生本轮构建                       | [build.log](../../agent/log/s15-logs/build.log)                               |
| `pnpm format:check`                                     | exit 1，同上，Prettier 未启动                      | [format-check.log](../../agent/log/s15-logs/format-check.log)                 |
| `pnpm verify:frontend`                                  | exit 1，同上，审计脚本未启动                       | [verify-frontend.log](../../agent/log/s15-logs/verify-frontend.log)           |
| `node scripts/audit-runtime-dependencies.mjs`           | exit 1，`Cannot read API TypeScript configuration` | [runtime-dependencies.log](../../agent/log/s15-logs/runtime-dependencies.log) |
| `node node_modules/prettier/bin/prettier.cjs --check .` | exit 0，所有匹配文件格式通过                       | 本轮直接执行输出                                                              |

`apps/api` 缺少 standalone 入口及 TypeScript 配置，多个 workspace 包缺少 manifest/源码。这些是当前完整门禁的阻塞条件，不能通过放宽配置、删除 workspace 依赖或沿用历史成功记录解决。本轮未执行 unit coverage、PostgreSQL integration 或 E2E；此前通过记录不代表本轮通过。

## 现存 frontend bundle 检查

对现存 `apps/vue/dist` 全部 26 个文件执行字符串扫描，并检查 `bundle-report.json` 的 128 个模块；读取本地环境和进程环境中数据库、secret、API key/token 变量的 6 个已知值，仅记录匹配数量，不输出凭据。

Next.js、`server-only`、数据库及模型 provider 模块匹配为 0；数据库 URL、provider API key 等敏感变量名、已知凭据值及服务端特征字符串匹配文件数为 0。详见 [frontend-artifact-scan.json](../../agent/log/s15-logs/frontend-artifact-scan.json)。

这仅验证已有产物的静态内容；产物文件时间为 2026-10-09，本轮 build 未成功，不能据此保证当前源码的新构建质量，也不能排除未知或编码后的凭据。恢复完整 standalone workspace 源码后仍需重新执行上述六条命令并审计新 bundle。
