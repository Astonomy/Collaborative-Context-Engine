import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it } from "vitest";
import { vueShell } from "./vue-shell";

let directory: string;
beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), "cce-vue-shell-"));
});
afterEach(async () => {
  await rm(directory, { recursive: true, force: true });
});

it("serves the same uncached Vue shell for entry, deep links and client-side 404 routes", async () => {
  await writeFile(join(directory, "index.html"), '<div id="app"></div>');
  for (const path of ["/vue", "/vue/", "/vue/projects/p/conversations/c", "/vue/unknown"]) {
    const response = await vueShell(new Request("http://localhost" + path), directory);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/html");
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.text()).toBe('<div id="app"></div>');
  }
});

it("does not replace missing scripts, workers or other assets with HTML", async () => {
  await writeFile(join(directory, "index.html"), "shell");
  for (const path of ["/vue/assets/missing.js", "/vue/assets/worker", "/vue/missing.png"]) {
    const response = await vueShell(new Request("http://localhost" + path), directory);
    expect(response.status).toBe(404);
    expect(await response.text()).not.toBe("shell");
  }
});

it("reports missing deployment assets as unavailable without leaking filesystem paths", async () => {
  const response = await vueShell(new Request("http://localhost/vue/"), directory);
  expect(response.status).toBe(503);
  expect(await response.text()).not.toContain(directory);
});
