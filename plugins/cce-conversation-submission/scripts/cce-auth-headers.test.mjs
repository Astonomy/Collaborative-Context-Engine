import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { after, test } from "node:test";
import { fileURLToPath } from "node:url";

const temporaryDirectories = [];
const script = fileURLToPath(new URL("./cce-auth-headers.mjs", import.meta.url));

after(async () => {
  const { rm } = await import("node:fs/promises");
  await Promise.all(temporaryDirectories.map((path) => rm(path, { recursive: true, force: true })));
});

async function configuration(value) {
  const directory = await mkdtemp(join(tmpdir(), "cce-auth-headers-"));
  temporaryDirectories.push(directory);
  const path = join(directory, ".mcp.json");
  await writeFile(path, JSON.stringify(value), "utf8");
  return path;
}

test("prints the Authorization header read from .mcp.json", async () => {
  const path = await configuration({
    mcpServers: {
      cce: { http_headers: { Authorization: "Bearer test-token-from-file" } },
    },
  });
  const result = spawnSync(process.execPath, [script, path], {
    encoding: "utf8",
    env: { ...process.env, CCE_MCP_ACCESS_TOKEN: "environment-token-must-not-win" },
  });

  assert.equal(result.status, 0);
  assert.deepEqual(JSON.parse(result.stdout), { Authorization: "Bearer test-token-from-file" });
  assert.doesNotMatch(result.stdout, /environment-token/);
});

test("rejects environment-only and malformed credential files", async () => {
  const environmentOnly = await configuration({
    mcpServers: { cce: { bearer_token_env_var: "CCE_MCP_ACCESS_TOKEN" } },
  });
  const malformedDirectory = await mkdtemp(join(tmpdir(), "cce-auth-headers-"));
  temporaryDirectories.push(malformedDirectory);
  const malformed = join(malformedDirectory, ".mcp.json");
  await writeFile(malformed, "not-json", "utf8");

  for (const path of [environmentOnly, malformed]) {
    const result = spawnSync(process.execPath, [script, path], {
      encoding: "utf8",
      env: { ...process.env, CCE_MCP_ACCESS_TOKEN: "ignored-environment-token" },
    });
    assert.notEqual(result.status, 0);
    assert.equal(result.stdout, "");
    assert.doesNotMatch(result.stderr, /ignored-environment-token/);
  }
});
