import { builtinModules } from "node:module";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import ts from "typescript";
import { expect, it } from "vitest";

const options: ts.CompilerOptions = {
  module: ts.ModuleKind.ESNext,
  moduleResolution: ts.ModuleResolutionKind.Bundler,
  target: ts.ScriptTarget.ES2023,
  jsx: ts.JsxEmit.ReactJSX,
  verbatimModuleSyntax: true,
  customConditions: ["browser"],
};
// Third-party browser entry points are additionally validated by the production Next build.
const browserLibraries = new Set(["react", "react/jsx-runtime", "zod"]);
function runtimeImports(filename: string, source: string): string[] {
  const emitted = ts.transpileModule(source, {
    fileName: filename,
    compilerOptions: options,
  }).outputText;
  const ast = ts.createSourceFile(
    filename,
    emitted,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.JS,
  );
  const imports: string[] = [];
  function visit(node: ts.Node): void {
    if (
      (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
      node.moduleSpecifier &&
      ts.isStringLiteral(node.moduleSpecifier)
    )
      imports.push(node.moduleSpecifier.text);
    if (
      ts.isCallExpression(node) &&
      (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
        (ts.isIdentifier(node.expression) && node.expression.text === "require"))
    ) {
      const argument = node.arguments[0];
      if (!argument || !ts.isStringLiteral(argument))
        throw new Error("Nonliteral browser import requires boundary review");
      imports.push(argument.text);
    }
    ts.forEachChild(node, visit);
  }
  visit(ast);
  return imports;
}
function checkGraph(entries: string[], overrides = new Map<string, string>()): Set<string> {
  const visited = new Set<string>();
  function walk(filename: string): void {
    filename = resolve(filename);
    if (visited.has(filename)) return;
    visited.add(filename);
    if (/\.server\.[cm]?[jt]sx?$/.test(filename))
      throw new Error(`Server parser in browser graph: ${filename}`);
    for (const specifier of runtimeImports(
      filename,
      overrides.get(filename) ?? readFileSync(filename, "utf8"),
    )) {
      if (specifier.startsWith("node:") || builtinModules.includes(specifier))
        throw new Error(`Node module in browser graph: ${specifier}`);
      if (browserLibraries.has(specifier)) continue;
      if (!specifier.startsWith(".") && !specifier.startsWith("@cce/"))
        throw new Error(`Unreviewed browser dependency: ${specifier}`);
      const target = ts.resolveModuleName(specifier, filename, options, ts.sys).resolvedModule;
      if (!target) throw new Error(`Unresolvable browser dependency: ${specifier}`);
      walk(target.resolvedFileName);
    }
  }
  entries.forEach(walk);
  return visited;
}
it("keeps every client entry and the public inspection contract free of Node/server parsers", () => {
  const root = resolve("apps/web");
  const entries = ts.sys
    .readDirectory(
      root,
      [".ts", ".tsx"],
      ["**/node_modules/**", "**/.next/**", "**/dist/**", "**/*.test.*", "**/*.d.ts"],
    )
    .filter((name) => /^['"]use client['"]/.test(readFileSync(name, "utf8")));
  expect(entries.length).toBeGreaterThan(0);
  entries.push(resolve("packages/application/src/media-inspection.ts"));
  const graph = checkGraph(entries);
  expect([...graph].some((name) => name.includes("media-inspector.server"))).toBe(false);
  // Full-graph transpilation under WSL coverage can exceed the default five seconds.
}, 30_000);
it.each(["node:zlib", "node:fs", "node:buffer", "zlib", "@cce/storage/media-server"])(
  "rejects a transitive barrel regression importing %s",
  (dependency) => {
    const entry = resolve("packages/application/src/media-inspection.ts");
    const barrel = resolve("packages/application/src/index.ts");
    expect(() =>
      checkGraph(
        [entry],
        new Map([
          [entry, 'export * from "./index";'],
          [barrel, `export * from "${dependency}";`],
        ]),
      ),
    ).toThrow();
  },
);
it("allows erased type imports and forbids dynamic server imports", () => {
  expect(
    runtimeImports("client.ts", 'import type { MediaInspector } from "@cce/application";'),
  ).toEqual([]);
  const entry = resolve("packages/application/src/media-inspection.ts");
  expect(() =>
    checkGraph([entry], new Map([[entry, 'export const load = () => import("node:zlib");']])),
  ).toThrow();
});
