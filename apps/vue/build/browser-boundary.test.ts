// @vitest-environment node
import { expect, it } from "vitest";
import { assertBrowserModule } from "./browser-boundary";
it.each([
  "node:fs",
  "crypto",
  "D:/repo/apps/api/server/request.ts",
  "D:\\repo\\packages\\database\\src\\index.ts",
  "x.server.ts",
  "__vite-browser-external",
  "D:/repo/node_modules/pg/lib/index.js",
])("rejects server graph module %s", (id) => {
  expect(() => assertBrowserModule(id)).toThrow();
});
it("allows browser contracts and Vue runtime", () => {
  expect(() => assertBrowserModule("D:/repo/packages/api-contracts/src/index.ts")).not.toThrow();
  expect(() =>
    assertBrowserModule("D:/repo/node_modules/vue/dist/vue.runtime.esm-bundler.js"),
  ).not.toThrow();
});
