import { readFile, readdir, mkdir, writeFile } from "node:fs/promises";
import { resolve, relative } from "node:path";
import ts from "typescript";

const root = process.cwd();
const manifests = new Map();
for (const parent of ["apps", "packages"]) {
  for (const directory of await readdir(parent, { withFileTypes: true })) {
    if (!directory.isDirectory()) continue;
    const path = `${parent}/${directory.name}/package.json`;
    try {
      const manifest = JSON.parse(await readFile(path, "utf8"));
      manifests.set(manifest.name, { path, manifest });
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
  }
}
const packageEdges = [];
const visited = new Set();
function visit(name) {
  if (visited.has(name)) return;
  visited.add(name);
  const item = manifests.get(name);
  if (!item) return;
  for (const dependency of Object.keys(item.manifest.dependencies ?? {})) {
    if (["next", "react", "react-dom", "@cce/web"].includes(dependency))
      throw new Error(`Forbidden production dependency: ${name} -> ${dependency}`);
    packageEdges.push({ from: name, to: dependency });
    visit(dependency);
  }
}
visit("@cce/api");
visit("@cce/vue");

const config = ts.readConfigFile("apps/api/tsconfig.json", ts.sys.readFile);
if (config.error) throw new Error("Cannot read API TypeScript configuration");
const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, resolve("apps/api"));
const program = ts.createProgram([resolve("apps/api/main.ts")], parsed.options);
const sourceEdges = [];
for (const source of program.getSourceFiles()) {
  if (source.isDeclarationFile || source.fileName.includes("node_modules")) continue;
  const from = relative(root, source.fileName).replaceAll("\\", "/");
  if (from.startsWith("apps/web/")) throw new Error(`Next source reachable: ${from}`);
  for (const imported of ts.preProcessFile(source.text).importedFiles) {
    const to = imported.fileName;
    if (/^(next(?:\/|$)|@cce\/web(?:\/|$))/.test(to) || to.includes("apps/web"))
      throw new Error(`Next import reachable: ${from} -> ${to}`);
    sourceEdges.push({ from, to });
  }
}
const bundle = JSON.parse(await readFile("apps/vue/dist/bundle-report.json", "utf8"));
if (bundle.modules.some((id) => /apps\/web|node_modules\/next\//.test(id)))
  throw new Error("Next reachable in Vue build graph");
const plugin = JSON.parse(await readFile("plugins/cce-conversation-submission/.mcp.json", "utf8"));
const pluginUrl = new URL(plugin.mcpServers.cce.url);
if (pluginUrl.port !== "3001" || pluginUrl.pathname !== "/mcp")
  throw new Error("Plugin default must target standalone API :3001/mcp");
await mkdir("docs/verification", { recursive: true });
await writeFile(
  "docs/verification/vue-api-dependency-graph.json",
  JSON.stringify(
    {
      packageEdges,
      sourceEdges,
      vueModules: bundle.modules,
      pluginEndpoint: pluginUrl.toString(),
      forbiddenNextEdges: 0,
      scope:
        "API entry source graph, transitive workspace production manifests, Vue build modules, plugin default endpoint. External package internals are validated by the isolated production deployment smoke test.",
    },
    null,
    2,
  ) + "\n",
);
console.log(
  `No Next edges: ${sourceEdges.length} API imports, ${bundle.modules.length} Vue modules.`,
);
