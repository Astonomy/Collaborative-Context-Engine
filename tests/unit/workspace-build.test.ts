import { execFileSync } from "node:child_process";
import { access, cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import ts from "typescript";
import { expect, it } from "vitest";

it("reads all 13 referenced package configurations and loads every public ESM entry with tsx", async () => {
  const root = ts.readConfigFile("tsconfig.json", (path) => ts.sys.readFile(path));
  expect(root.error).toBeUndefined();
  const config = ts.parseJsonConfigFileContent(root.config, ts.sys, process.cwd());
  expect(config.projectReferences).toHaveLength(13);
  const entries: string[] = [];
  for (const reference of config.projectReferences ?? []) {
    const filename = join(reference.path, "tsconfig.json");
    const parsed = ts.getParsedCommandLineOfConfigFile(
      filename,
      {},
      {
        ...ts.sys,
        onUnRecoverableConfigFileDiagnostic: (error) => {
          throw new Error(ts.flattenDiagnosticMessageText(error.messageText, "\n"));
        },
      },
    );
    expect(parsed?.errors).toEqual([]);
    expect(parsed?.fileNames.length).toBeGreaterThan(0);
    const manifest: unknown = JSON.parse(
      await readFile(join(reference.path, "package.json"), "utf8"),
    );
    if (
      !manifest ||
      typeof manifest !== "object" ||
      !("name" in manifest) ||
      typeof manifest.name !== "string" ||
      !("exports" in manifest) ||
      !manifest.exports ||
      typeof manifest.exports !== "object"
    ) {
      throw new Error(`Invalid workspace manifest: ${reference.path}`);
    }
    for (const subpath of Object.keys(manifest.exports)) {
      entries.push(manifest.name + (subpath === "." ? "" : subpath.slice(1)));
    }
  }
  execFileSync(
    process.execPath,
    [
      "--import",
      "tsx",
      "--input-type=module",
      "-e",
      `for (const entry of ${JSON.stringify(entries)}) await import(entry);`,
    ],
    { cwd: process.cwd() },
  );
  expect(() =>
    execFileSync(
      process.execPath,
      ["--import", "tsx", "--input-type=module", "-e", 'await import("@cce/database/index.js")'],
      { stdio: "pipe" },
    ),
  ).toThrow(/ERR_PACKAGE_PATH_NOT_EXPORTED/);
}, 30_000);

it.each(["@cce/server-runtime", "@cce/storage/media-server"])(
  "blocks the server-only entry %s under the browser condition",
  (entry) => {
    expect(() =>
      execFileSync(
        process.execPath,
        [
          "--conditions=browser",
          "--input-type=module",
          "-e",
          `import.meta.resolve(${JSON.stringify(entry)})`,
        ],
        { stdio: "pipe" },
      ),
    ).toThrow(/ERR_PACKAGE_PATH_NOT_EXPORTED/);
  },
);

it("cleans only the requested build outputs before rebuilding", async () => {
  const root = await mkdtemp(join(tmpdir(), "cce-build-clean-"));
  try {
    await mkdir(join(root, "scripts"));
    await cp(resolve("scripts/clean.mjs"), join(root, "scripts/clean.mjs"));
    const paths = [
      "packages/example/dist/old.js",
      "apps/api/dist/old.js",
      "apps/vue/dist/old.js",
      "packages/example/src/index.ts",
      "coverage/keep.txt",
    ];
    for (const path of paths) {
      await mkdir(join(root, path, ".."), { recursive: true });
      await writeFile(join(root, path), "fixture");
    }
    execFileSync(process.execPath, [join(root, "scripts/clean.mjs"), "--api"]);
    for (const path of paths.slice(0, 2)) await expect(access(join(root, path))).rejects.toThrow();
    for (const path of paths.slice(2)) await access(join(root, path));
    execFileSync(process.execPath, [join(root, "scripts/clean.mjs"), "--frontend"]);
    await expect(access(join(root, "apps/vue/dist/old.js"))).rejects.toThrow();
    await access(join(root, "packages/example/src/index.ts"));
    await access(join(root, "coverage/keep.txt"));
    expect(() =>
      execFileSync(process.execPath, [join(root, "scripts/clean.mjs"), "--unknown"], {
        stdio: "pipe",
      }),
    ).toThrow(/Unknown clean mode/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
