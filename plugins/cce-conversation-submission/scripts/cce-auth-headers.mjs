import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join, normalize, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const pluginName = "cce-conversation-submission";
const scriptPath = fileURLToPath(import.meta.url);

export function credentialPaths(explicitPath = process.argv[2]) {
  if (explicitPath !== undefined) return [resolve(explicitPath)];

  const paths = [];
  const normalizedScriptPath = normalize(scriptPath);
  const cacheMarker = `${sep}plugins${sep}cache${sep}`;
  const markerIndex = normalizedScriptPath.indexOf(cacheMarker);
  if (markerIndex >= 0) {
    const codexHome = normalizedScriptPath.slice(0, markerIndex);
    paths.push(join(codexHome, "plugin-data", pluginName, ".mcp.json"));
  }
  paths.push(join(homedir(), ".codex", "plugin-data", pluginName, ".mcp.json"));
  return [...new Set(paths)];
}

export async function readAuthorizationHeader(paths = credentialPaths()) {
  for (const path of paths) {
    let document;
    try {
      document = JSON.parse(await readFile(path, "utf8"));
    } catch (error) {
      if (error?.code === "ENOENT") continue;
      throw new Error(`CCE credential file is not valid JSON: ${path}`);
    }

    const authorization = document?.mcpServers?.cce?.http_headers?.Authorization;
    if (typeof authorization !== "string" || !/^Bearer\s+\S.+$/u.test(authorization)) {
      throw new Error(
        `CCE credential file must define mcpServers.cce.http_headers.Authorization as a Bearer value: ${path}`,
      );
    }
    return authorization;
  }

  throw new Error(`CCE credential file was not found. Expected: ${paths.join(", ")}`);
}

async function main() {
  const authorization = await readAuthorizationHeader();
  process.stdout.write(JSON.stringify({ Authorization: authorization }));
}

main().catch((error) => {
  process.stderr.write(
    `${error instanceof Error ? error.message : "CCE credential read failed."}\n`,
  );
  process.exitCode = 1;
});
