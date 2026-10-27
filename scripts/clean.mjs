import { rm } from "node:fs/promises";
import { readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

const root = fileURLToPath(new URL("../", import.meta.url));
const mode = process.argv[2];
if (mode !== undefined && mode !== "--api" && mode !== "--frontend") {
  throw new Error(`Unknown clean mode: ${mode}`);
}
const generatedDirectories = mode ? [] : ["coverage", "playwright-report", "test-results"];
if (mode === "--api") {
  generatedDirectories.push("apps/api/dist");
  for (const entry of await readdir(new URL("../packages/", import.meta.url), {
    withFileTypes: true,
  })) {
    if (entry.isDirectory()) generatedDirectories.push(`packages/${entry.name}/dist`);
  }
}
if (mode === "--frontend") generatedDirectories.push("apps/vue/dist");

await Promise.all(
  generatedDirectories.map((directory) =>
    rm(resolve(root, directory), { recursive: true, force: true }),
  ),
);
