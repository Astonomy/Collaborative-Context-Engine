import { readFile, readdir, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";

const forbidden =
  /node:(?:fs|zlib|crypto|child_process)|PostgresUnitOfWork|DATABASE_URL|CCE_SESSION_SECRET|MODEL_API_KEY|CCE_MCP_ACCESS_TOKEN|CCE_ATTACHMENT_STORAGE_DIRECTORY|HeaderMediaInspector|QwenVllmModelProvider|pg-protocol|drizzle-orm|__vite-browser-external/g;
const secrets = [
  "DATABASE_URL",
  "CCE_SESSION_SECRET",
  "MODEL_API_KEY",
  "CCE_SEED_API_TOKEN",
  "CCE_MCP_ACCESS_TOKEN",
]
  .map((key) => process.env[key])
  .filter((value) => value && value.length >= 16);
async function scan(directory) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await scan(path)));
    else if (entry.name.endsWith(".js")) {
      const source = await readFile(path, "utf8");
      const matches = [...source.matchAll(forbidden)].map((match) => match[0]);
      if (matches.length || secrets.some((secret) => source.includes(secret))) {
        throw new Error(
          `Browser boundary violation in ${path}; inspect locally without logging credentials`,
        );
      }
      files.push(path.replaceAll("\\", "/"));
    }
  }
  return files;
}
const next = process.argv.includes("--vue-only") ? [] : await scan("apps/web/.next/static");
const vue = await scan("apps/vue/dist/assets");
await mkdir("docs/verification", { recursive: true });
await writeFile(
  "docs/verification/s8-browser-audit.json",
  JSON.stringify(
    {
      next,
      vue,
      forbiddenMatches: 0,
      knownCredentialMatches: 0,
      limitation:
        "Artifact string scan supplements Vue build module-graph enforcement; not a proof against arbitrary obfuscation.",
    },
    null,
    2,
  ) + "\n",
);
console.log(
  `Browser artifact audit passed: Next ${next.length}, Vue ${vue.length} JS files (including worker).`,
);
