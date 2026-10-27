# CCE Scope B — Quality Gate & Recovery Artifacts

日期：2026-10-24（Asia/Shanghai）。执行环境：Ubuntu WSL2，Node 24.22.0、pnpm 11.22.0。

## 原始错误分类

历史验收的 [lint 完整日志](../../agent/log/final-decoupling-20261016/lint.log) 为 4527 errors、0 warnings、79 个报错文件；[format 完整日志](../../agent/log/final-decoupling-20261016/format.log) 为 exit 2。逐行解析日志得到以下互斥分类；损坏副本优先归 F，生成的恢复索引归 E。

| 类别                                     | lint 报错文件 | lint errors | format 诊断文件 | 处理方式                                        |
| ---------------------------------------- | ------------: | ----------: | --------------: | ----------------------------------------------- |
| A. Active production source              |             0 |           0 |               0 | 保持生产实现                                    |
| B. Active tests/scripts                  |             0 |           0 |               2 | 格式化 H4 browser/MCP evidence scripts          |
| C. Historical recovery artifacts         |             1 |           7 |               1 | 保留归档中的 replay.cjs 原始内容                |
| D. Candidate source copies               |            78 |        4520 |              83 | 保留已有非执行压缩归档                          |
| E. Generated logs/reports                |             0 |           0 |              16 | 保留 H0/H1 生成索引和恢复报告                   |
| F. Invalid or malformed archived sources |             0 |           0 |               1 | 保留损坏 ImagePreview.vue，不修写历史证据       |
| 合计                                     |            79 |        4527 |             103 | 102 个格式 warning 文件和 1 个 parse error 文件 |

[逐文件分类及保留位置](../../agent/log/quality-gate-scope-b/classification.md) 列出每个诊断文件、错误数、TS/package exports/runtime/tests 引用判定和归档成员路径。分类脚本为 [classify.py](../../agent/log/quality-gate-scope-b/classify.py)。

## 引用核验与归档

开始本任务时，原 `CCE-h0-snapshot-20261015-162325/` 和 `CCE-h1-recovery/` 已按仓库既有规则归档；这不是本次新执行的搬移。原 4527 个错误属于归档前验收，不能冒充本轮复现结果。

- 根 `tsconfig.json` references 指向正式 packages；各包 include 指向各自 `src`，apps 配置指向各自源码；`tsconfig.tools.json` include 指向根配置、scripts、tests、正式 packages/apps 测试，不包含恢复材料。
- `pnpm-workspace.yaml` 只注册 `apps/*` 和 `packages/*`；逐包 exports 指向正式包内实现。candidate 内的 package.json 是快照，不是根工作区注册的包。
- 根和各 workspace scripts、Vitest 配置使用正式路径；生产代码、测试及配置的恢复路径搜索命中仅为历史说明文档。参见 [引用搜索](../../agent/log/quality-gate-scope-b/reference-search.log) 与 [项目输入配置](../../agent/log/quality-gate-scope-b/project-inputs.log)。
- `replay.cjs` 内明确把 `D:/code/CCE-h1-recovery/candidate` 作为输出，读取历史 events，重放 patch，生成 provenance 和 replay-failures；它属于一次性恢复过程，不是运行时依赖或正式维护入口。只读取原文，没有执行重放。
- H4 两个 `.mjs` 是验收报告明确引用的可手动执行脚本；MCP 脚本导入真实 plugin helper，browser 脚本使用 Playwright。继续按脚本接受 lint/format 检查，不归档规避问题。

| 保留材料                                                  | 当前位置                                              |
| --------------------------------------------------------- | ----------------------------------------------------- |
| H0 工作区快照                                             | `agent/archive/recovery/h0/workspace.tar.gz`          |
| H0 构建/coverage 恢复产物                                 | `agent/archive/recovery/h0/recovery-artifacts.tar.gz` |
| H0 Git bundle                                             | `agent/archive/recovery/h0/repository.bundle`         |
| H0 索引、patch、Git 记录                                  | `agent/archive/recovery/h0/metadata.tar.gz`           |
| H1 全部 candidate、provenance、events、replay、失败记录等 | `agent/archive/recovery/h1-materials.tar.gz`          |
| H1 原始验证日志                                           | `agent/log/recovery/h1/`                              |

完整 716 个原始文件见 [inventory.json](../../agent/archive/recovery/inventory.json)，规则及历史归档校验见 [归档 README](../../agent/archive/recovery/README.md)。本轮读取 tar 成员，核实 H1 的 685 个文件路径和大小均匹配 inventory，全部诊断涉及的 H1 文件均仍在归档中；H0 两个报格式 warning 的 JSON 仍在 metadata 归档中。没有重新压缩、修改或删除这些归档。恢复时按既有规则解压到独立恢复目录，避免重新把历史副本放回质量工具扫描树。

## ImagePreview.vue 根因

历史报错路径为 `CCE-h1-recovery/candidate/apps/vue/src/attachments/ImagePreview.vue`。归档原文第 24 行在 `</template>` 后继续拼接 `const dimensions = computed(...)`，第 25 行出现多余 `</script>`，随后重复整个 template，因此 Prettier 报 `Unexpected closing tag "script"`。这是损坏的历史候选副本，不是当前组件。只凭现有证据不能确定是哪一次重放操作造成拼接。

当前 `apps/vue/src/attachments/ImagePreview.vue` 只有一组 script/template，保持原样。损坏原文完整保留在 H1 归档中，另有只读提取的 [文本证据](../../agent/log/quality-gate-scope-b/archived-ImagePreview.vue.txt)。压缩归档不会被识别为可构建 Vue SFC，无需通过删除或修改历史内容消除 parse error。

## 本轮修改与质量配置

本轮修改：

- `agent/log/h4-logs/browser.mjs`、`mcp-plugin.mjs`：只做 Prettier 格式修复，保留执行语义及真实 helper 调用。由于既有 `.gitignore` 忽略 `agent/`，另外显式指定 `.prettierignore` 检查这两个文件，并逐文件执行 ESLint 和 `node --check`，见 [H4 检查日志](../../agent/log/quality-gate-scope-b/h4-checks.log)。
- `docs/verification/s14-vue-e2e.md`、`s15-quality.md`：修复本轮检测出的 Markdown 表格格式，保留历史验收结论。
- `tests/unit/server-runtime.test.ts` 的 plain Node 启动测试：局部 timeout 从默认 5000ms 调整为 30000ms。
- `tests/unit/standalone-media-mcp-boundary.test.ts` 的完整编译依赖图测试：局部 timeout 从 30000ms 调整为 60000ms。
- 新增本文及 `agent/log/quality-gate-scope-b/` 分类、检查证据。

两处测试调整源于连续两次完整 coverage 的可复现超时。第二次单独运行时，Node 启动实际耗时 13839ms，编译图扫描 37192ms；失败原因为超时，没有断言失败。两项均加载跨 workspace 依赖，扫描还包括外部声明文件。仅增加这两项在 WSL 挂载目录下的执行时间预算，断言、测试数量和 coverage 阈值保持原样，没有全局提高 timeout。首轮及隔离复跑日志分别见 [initial](../../agent/log/quality-gate-scope-b/test-coverage-initial.log)、[isolated](../../agent/log/quality-gate-scope-b/test-coverage-isolated.log)，均 exit 1、529 passed / 2 timed out。

没有修改 ESLint/Prettier/TypeScript/Vitest 配置、质量命令或 CI，没有新增 ignore 或 eslint-disable。已有压缩归档足以使恢复证据不作为源码扫描，无需排除正式源码。生产实现及最终 DECOUPLED 判定保持原样。

## 完整质量门禁

本轮完整日志和真实退出码保存在 [quality-gate-scope-b](../../agent/log/quality-gate-scope-b/)。WSL 初始 PATH 曾误命中 Windows Volta 的 pnpm wrapper，未启动检查；随后显式使用现有 Linux Node/pnpm。以下结果只认实际运行的质量命令，不把 wrapper 失败当作源码诊断。

本轮首次实际 lint 为 exit 0，见 [baseline-lint.log](../../agent/log/quality-gate-scope-b/baseline-lint.log)。修复前 format 为 exit 1：两份历史文档及新增报告草稿有格式 warning，无 Vue parse error，见 [format-check-initial.log](../../agent/log/quality-gate-scope-b/format-check-initial.log)。原先串行排在 lint 后面的检查较晚完成，其 `baseline-format.log` 已处于格式修正后，exit 0；不把这个结果作为修复前基线。

最终六项命令串行执行，全部 exit 0。`.exit` 文件由执行器直接记录子进程返回值。

| 命令                   | 退出码 | 结果                                                                           | 完整日志                                                                        |
| ---------------------- | -----: | ------------------------------------------------------------------------------ | ------------------------------------------------------------------------------- |
| `pnpm lint`            |      0 | 全仓 ESLint，0 errors / 0 warnings                                             | [lint.log](../../agent/log/quality-gate-scope-b/lint.log)                       |
| `pnpm format:check`    |      0 | All matched files use Prettier code style                                      | [format-check.log](../../agent/log/quality-gate-scope-b/format-check.log)       |
| `pnpm typecheck`       |      0 | packages、tools、API、Web、Vue 类型检查通过                                    | [typecheck.log](../../agent/log/quality-gate-scope-b/typecheck.log)             |
| `pnpm build`           |      0 | API 与 Vue production build 通过                                               | [build.log](../../agent/log/quality-gate-scope-b/build.log)                     |
| `pnpm verify:frontend` |      0 | Next 0，Vue 22 JS files（含 worker）审计通过                                   | [verify-frontend.log](../../agent/log/quality-gate-scope-b/verify-frontend.log) |
| `pnpm test:coverage`   |      0 | 根项目 66 files / 531 tests，Vue 18 files / 142 tests，plugin 4 tests 全部通过 | [test-coverage.log](../../agent/log/quality-gate-scope-b/test-coverage.log)     |

| 覆盖率范围 | Statements | Branches | Functions |  Lines |
| ---------- | ---------: | -------: | --------: | -----: |
| 根项目     |     91.64% |   84.56% |    96.15% | 92.28% |
| Vue        |     96.32% |   88.35% |    93.39% | 98.69% |

全部既有 coverage 阈值通过。报告补齐结果后再次运行全仓 `pnpm format:check`，结果记录于同一 format 日志；其余文件没有继续变更。

最终架构状态保持 **DECOUPLED**。
