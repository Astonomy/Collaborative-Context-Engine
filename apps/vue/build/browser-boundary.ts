import { builtinModules } from "node:module";
import { gzipSync } from "node:zlib";
import type { Plugin } from "vite";

export function assertBrowserModule(id: string): void {
  const path = id.replaceAll("\\", "/");
  if (
    id.startsWith("node:") ||
    builtinModules.includes(id) ||
    /__vite-browser-external|\/(?:apps\/(?:api|web)|packages\/(?:database|application|storage|model-provider|mcp-server))\/|\.server\.|node_modules\/(?:pg|next|sharp|@modelcontextprotocol)\//.test(
      path,
    )
  ) {
    throw new Error(`Server dependency in Vue browser graph: ${id}`);
  }
}

export function browserBoundary(): Plugin {
  return {
    name: "cce-browser-boundary",
    enforce: "pre",
    resolveId(source) {
      assertBrowserModule(source);
      return null;
    },
    moduleParsed(module) {
      assertBrowserModule(module.id);
    },
    generateBundle: {
      order: "post",
      handler(_options, bundle) {
        const modules = new Set<string>();
        const chunks: { file: string; bytes: number; gzip9: number; entry: boolean }[] = [];
        for (const output of Object.values(bundle)) {
          if (output.type !== "chunk") continue;
          for (const id of Object.keys(output.modules)) {
            assertBrowserModule(id);
            modules.add(id.replaceAll("\\", "/"));
          }
          chunks.push({
            file: output.fileName,
            bytes: Buffer.byteLength(output.code),
            gzip9: gzipSync(output.code, { level: 9 }).byteLength,
            entry: output.isEntry,
          });
        }
        const initial = new Set<string>();
        const visit = (file: string): void => {
          if (initial.has(file)) return;
          initial.add(file);
          const chunk = bundle[file];
          if (chunk?.type === "chunk") chunk.imports.forEach(visit);
        };
        chunks.filter((chunk) => chunk.entry).forEach((chunk) => visit(chunk.file));
        const initialGzip9 = chunks
          .filter((chunk) => initial.has(chunk.file))
          .reduce((sum, chunk) => sum + chunk.gzip9, 0);
        if (initialGzip9 > 120_000)
          throw new Error(`Initial JS budget exceeded: ${initialGzip9} > 120000 bytes gzip-9`);
        this.emitFile({
          type: "asset",
          fileName: "bundle-report.json",
          source: JSON.stringify(
            { initialGzip9, initialFiles: [...initial], chunks, modules: [...modules].sort() },
            null,
            2,
          ),
        });
      },
    },
  };
}
