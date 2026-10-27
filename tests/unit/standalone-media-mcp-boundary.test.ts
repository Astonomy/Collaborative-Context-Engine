import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import ts from "typescript";
import { expect, it } from "vitest";
import { z } from "zod";

it("keeps standalone media and MCP transitive source imports independent of Next and apps/web", () => {
  const config = ts.readConfigFile("apps/api/tsconfig.json", (path) => ts.sys.readFile(path));
  if (config.error) throw new Error("Cannot read standalone TypeScript configuration");
  const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, resolve("apps/api"));
  const program = ts.createProgram([resolve("apps/api/main.ts")], parsed.options);
  const sources = program
    .getSourceFiles()
    .filter((source) => !source.isDeclarationFile && !source.fileName.includes("node_modules"));
  expect(
    sources.some((source) =>
      source.fileName.replaceAll("\\", "/").includes("handlers/mcp/route.ts"),
    ),
  ).toBe(true);
  expect(
    sources.some((source) =>
      source.fileName.replaceAll("\\", "/").includes("server/attachment-content.ts"),
    ),
  ).toBe(true);
  for (const source of sources) {
    expect(source.fileName.replaceAll("\\", "/")).not.toContain("apps/web/");
    for (const imported of ts.preProcessFile(source.text).importedFiles) {
      expect(imported.fileName).not.toMatch(/^(next(?:\/|$)|@cce\/web(?:\/|$))|apps\/web/);
    }
  }
  // This constructs the complete compiler graph, including external declarations.
  // Coverage runs on the WSL-mounted workspace can exceed thirty seconds.
}, 60_000);

it("targets standalone :3001 for plugin MCP and binary uploads without browser capture", () => {
  const config = z
    .object({
      mcpServers: z.object({ cce: z.object({ url: z.string(), http_headers_helper: z.string() }) }),
    })
    .parse(JSON.parse(readFileSync("plugins/cce-conversation-submission/.mcp.json", "utf8")));
  expect(config.mcpServers.cce.url).toBe("http://localhost:3001/mcp");
  expect(config.mcpServers.cce.http_headers_helper).toBe("node scripts/cce-auth-headers.mjs");
  for (const name of ["cce-upload-attachments.mjs", "cce-auth-headers.mjs"]) {
    const source = readFileSync(`plugins/cce-conversation-submission/scripts/${name}`, "utf8");
    expect(source).not.toMatch(
      /localhost:3000|127\.0\.0\.1:3000|document\.|window\.|puppeteer|playwright|cookies/,
    );
  }
  const skill = readFileSync(
    "plugins/cce-conversation-submission/skills/submit-cce-conversation/SKILL.md",
    "utf8",
  );
  expect(skill).toContain("never put them in a prompt, this Skill, or capture JSON");
  expect(skill).not.toMatch(/CCE_MCP_ACCESS_TOKEN\s*[:=]/);
});
