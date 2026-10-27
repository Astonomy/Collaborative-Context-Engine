# H2 build recovery

日期：2026-10-15（Asia/Shanghai）。前置：[H1 source recovery](h1-source-recovery.md)。

## 结果

本 Scope 通过：pnpm 识别全部 **17 个 workspace projects（根 + 3 apps + 13 packages）**；
共享包 TypeScript 配置及公开入口均可读取、解析和加载；API、Vue 从清理后的输出目录构建成功。
Windows 工作区和 WSL Linux 独立副本均通过 install、lint、typecheck、build、frontend audit、runtime dependency audit。
本报告不更新最终 DECOUPLED 状态。

## Workspace 和 TypeScript

`pnpm-workspace.yaml` 的 `apps/*`、`packages/*` 覆盖所有应用与共享包。
`pnpm install --frozen-lockfile` 退出 0；所有 `workspace:*` 均有对应 manifest 和本地链接，未改锁文件或减少 workspace。

根 `tsconfig.json` 的 13 个 references 为：shared、domain、context-engine、conversation-import、
application、api-contracts、mcp-server、database、model-provider、agents、test-support、storage、server-runtime。
H0 所列 13 个缺失 tsconfig 已在 H1 恢复；H2 用 TypeScript 配置解析 API 逐个读取并检查非空输入文件，
再执行完整 `tsc -b`，无需重复生成或覆盖这些配置。
共享 `tsconfig.package.json` 配置 composite、declarations、`src` rootDir、`dist` outDir 和位于 dist 内的 build info。
根 build references 负责拓扑构建，不靠命令中包名排列猜测顺序；其后才编译 API。

## ESM、exports 和 loader 根因

- 共享包使用 `type: module`，公开 `exports` 指向真实 `src/*.ts` 文件。这是一条明确依赖 `tsx` 的源码加载链。
  `main`/`types` 未单独设置不构成错误：exports 提供入口，TypeScript 的 Bundler resolution 可直接读取 `.ts` 类型。
- `@cce/database` 映射 `./src/index.ts`；`@cce/database/runtime` 映射 `./src/runtime.ts`。
  `@cce/database/index.js` 并非公开子路径，当前实际结果为 `ERR_PACKAGE_PATH_NOT_EXPORTED`。
  不应猜测包根 `index.js`，也不应将它改成不存在的 `dist/index.js`。
- H0 的 manifest、源码和 tsconfig 缺失是恢复前的结构性问题；H1 已补齐。
  H2 无法从当前树复现恢复前的完整报错栈，不把当前未导出子路径错误冒充历史报错的唯一原因。
- 现有源码相对 imports 省略扩展名，tsconfig 使用 ESNext/Bundler，不是原生 NodeNext JS 发布配置。
  `tsc` 输出也保留这些 imports，因此生产 API 同样需要 `node --import tsx`。
  根 start、API package start、Docker CMD 均已携带此 loader，API manifest 已声明生产依赖 tsx。
  本轮保留此一致方案；没有声称输出可以脱离 loader 运行。
- 新增回归测试使用独立 Node 子进程加 `--import tsx` 加载 13 个包的所有公开入口，
  并断言 database 的错误子路径返回上述精确错误码。
  Windows 和 Linux 还实际加载了本轮 `apps/api/dist/apps/api/http-server.js`，均成功。
- Vitest 负责测试模块转换；全量测试实际通过，未用空 alias 替代任何生产模块。

## 依赖方向和 server-only

API 与共享包源码/manifest 检查未发现 Next runtime 或 `apps/api → apps/web` 依赖。
runtime audit 实际检查 **513 条 API imports、128 个 Vue modules**，报告无 Next edges。
domain/context-engine 继续通过应用外的 domain/shared 边界工作，没有新增 provider 或数据库依赖。

server-runtime 根入口、storage 的 `media-server` 子入口已有 `browser: null` 与 Node 条件导出。
新增测试用 `node --conditions=browser` 验证两者均返回 `ERR_PACKAGE_PATH_NOT_EXPORTED`，
并通过普通 Node + tsx 验证服务器加载成功。共享包不引入 Next 的裸 `server-only` marker；
浏览器边界由条件导出、现有 Vue 模块图检查及产物审计共同验证。

## 本轮改动

1. `scripts/clean.mjs` 增加 `--api`、`--frontend`：前者清除 API 和所有共享包 dist，
   后者清除 Vue dist；路径以脚本所在仓库为基准，不依赖调用者 cwd。未知模式立即失败。
   默认 clean 保留原有 coverage/report 清理用途。
2. 根 `build:api`、`build:frontend` 在编译前调用对应清理模式；保留所有 13 个包的构建任务。
3. `tests/unit/workspace-build.test.ts` 添加四项回归检查：配置与公开入口、两个 server-only 入口、
   清理范围及未知参数错误路径。临时目录中的旧产物被删除，源码及另一侧产物保持可读。
4. `scripts/audit-browser-bundles.mjs` 的 JSON 输出补末尾换行，避免运行 audit 后 format gate 失败。
5. 现有 standalone 依赖图测试在 coverage 下两次耗时约 7–9 秒，触发默认 5 秒超时。
   仅将这一项完整 compiler graph 检查的时限设为 30 秒；保留全部断言、测试和 coverage 门槛。
6. `docs/testing.md` 补充构建清理、ESM loader 与正确包入口说明。

## 全新构建证据

Windows：Node **24.15.0**，pnpm **11.22.0**。
API/shared dist 与 Vue dist 在本轮构建命令中先被删除；Vue 输出为 Vite 8.3.1 本轮生成，
206 个转换模块、22 个 JS 文件（含 worker），入口 `assets/index-Bm7WWPB8.js`。

Linux：WSL Ubuntu、原生 Node **24.22.0**、pnpm **11.22.0**；独立目录
`/tmp/cce-h2-build-kV6ifJ`。rsync 复制源码时排除了所有 node_modules、dist、.next、
coverage、build info、旧 public/vue、环境文件与附件存储，再独立执行 frozen install。
没有使用 Windows node_modules，也没有复制旧 Vue bundle 或共享包输出；API/Vue 构建和审计均退出 0。
Vue 入口文件名与 Windows 本轮产物一致。Linux 运行日志保存于该目录的
`install.log`、`lint.log`、`typecheck.log`、`build.log`、`frontend.log`、`audit.log`、
`workspace-test.log`、`workspace-list.log`。

| 命令                                          | Windows 结果                              | Linux 独立副本结果         |
| --------------------------------------------- | ----------------------------------------- | -------------------------- |
| `pnpm install --frozen-lockfile`              | 通过，17 projects                         | 通过，全新安装             |
| `pnpm lint`                                   | 通过，0 warnings                          | 通过                       |
| `pnpm typecheck`                              | 通过，含 shared/tools/API/web/Vue         | 通过                       |
| `pnpm build`                                  | 通过，清理后构建 API + Vue                | 通过，清理后构建 API + Vue |
| `pnpm verify:frontend`                        | 通过，22 JS files                         | 通过，22 JS files          |
| `node scripts/audit-runtime-dependencies.mjs` | 通过，513 imports / 128 modules           | 通过，同计数               |
| `pnpm format:check`                           | 通过                                      | 未单独执行                 |
| `pnpm test`                                   | 通过，531 root + 142 Vue + 4 plugin tests | 仅执行新增回归：4 项通过   |
| `pnpm test:coverage`                          | 通过，原门槛保留                          | 未执行                     |

根 coverage：statements **91.64%**、branches **84.56%**、functions **96.15%**、lines **92.28%**。
Vue coverage：lines **98.69%**。Windows 完整命令日志在仓库 ignored 的 `../../agent/log/legacy-root/h2-*.log` 中。
两次 coverage 超时和首次生成报告缺换行的失败均已归因并修复；最终结果见上表。

本轮没有剩余 lint/typecheck 错误，未添加 any、关闭规则、跳过任务或使用占位包。
此报告验收 workspace 和构建恢复；未运行 PostgreSQL integration、迁移、E2E 或容器部署验收。
