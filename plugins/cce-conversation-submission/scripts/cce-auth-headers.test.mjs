import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
const script = fileURLToPath(new URL("./cce-auth-headers.mjs", import.meta.url));
test("reads only the process environment", () => {
  const result = spawnSync(process.execPath, [script, "unused-credential-file"], {
    encoding: "utf8",
    env: { ...process.env, CCE_MCP_ACCESS_TOKEN: "test-env-token" },
  });
  assert.equal(result.status, 0);
  assert.deepEqual(JSON.parse(result.stdout), { Authorization: "Bearer test-env-token" });
});
test("rejects missing and malformed tokens without exposing them", () => {
  for (const token of ["", "secret with whitespace", "secret\nheader"]) {
    const result = spawnSync(process.execPath, [script], {
      encoding: "utf8",
      env: { ...process.env, CCE_MCP_ACCESS_TOKEN: token },
    });
    assert.notEqual(result.status, 0);
    assert.equal(result.stdout, "");
    assert.ok(!result.stderr.includes("secret"));
  }
});
