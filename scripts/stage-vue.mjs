import { cp, mkdir, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const source = new URL("../apps/vue/dist/", import.meta.url);
const target = new URL("../apps/web/public/vue/", import.meta.url);
const html = await readFile(new URL("index.html", source), "utf8");
if (!html.includes('src="/vue/assets/')) {
  throw new Error("The default deployment requires Vue built with VITE_APP_BASE=/vue/.");
}
await mkdir(target, { recursive: true });
// Retain previous hashed assets for open tabs during a local rebuild. Releases roll back as a unit.
await cp(new URL("assets/", source), new URL("assets/", target), { recursive: true });
await cp(new URL("index.html", source), new URL("index.html", target));
console.log(`Staged Vue browser assets at ${fileURLToPath(target)}`);
