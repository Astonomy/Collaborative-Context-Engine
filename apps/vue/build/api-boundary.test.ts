// @vitest-environment node
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { expect, it } from "vitest";

it("keeps Vue browser source independent of the legacy runtime", () => {
  const source = resolve(import.meta.dirname, "../src");
  for (const file of readdirSync(source, { recursive: true, encoding: "utf8" })) {
    if (!/\.(?:ts|vue|css)$/.test(file) || file.endsWith(".test.ts")) continue;
    const text = readFileSync(resolve(source, file), "utf8");
    expect(text, file).not.toMatch(
      /apps\/web|localhost:3000|NEXT_PUBLIC_|from\s+["']next(?:\/|["'])/,
    );
    expect(text, file).not.toMatch(/from\s+["']@cce\/(?:database|application|storage|mcp-server)/);
  }
});
