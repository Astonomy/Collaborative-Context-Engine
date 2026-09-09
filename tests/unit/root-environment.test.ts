import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { loadRepositoryEnvironment } from "../../scripts/load-root-environment.mjs";
import {
  parseMigrationEnvironment,
  parseSeedEnvironment,
} from "../../packages/database/src/cli/environment";

const originalEnvironment = { ...process.env };
const temporaryDirectories: string[] = [];

afterEach(async () => {
  for (const name of Object.keys(process.env)) {
    if (!(name in originalEnvironment)) {
      delete process.env[name];
    }
  }
  Object.assign(process.env, originalEnvironment);
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true })),
  );
});

async function writeEnvironment(contents: string): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "cce-environment-"));
  temporaryDirectories.push(directory);
  const path = join(directory, ".env");
  await writeFile(path, contents, "utf8");
  return path;
}

describe("repository environment bootstrap", () => {
  it("loads values from an environment file without replacing process values", async () => {
    const path = await writeEnvironment(
      "CCE_TEST_FROM_ROOT=from-file\nCCE_TEST_OVERRIDE=from-file\n",
    );
    process.env["CCE_TEST_OVERRIDE"] = "from-process";

    loadRepositoryEnvironment(path);

    expect(process.env["CCE_TEST_FROM_ROOT"]).toBe("from-file");
    expect(process.env["CCE_TEST_OVERRIDE"]).toBe("from-process");
  });

  it("allows a missing environment file when required values are injected", () => {
    process.env["DATABASE_URL"] = "postgresql://injected.example/cce";

    expect(() => loadRepositoryEnvironment(join(tmpdir(), "cce-missing", ".env"))).not.toThrow();
    expect(parseMigrationEnvironment(process.env).DATABASE_URL).toBe(
      "postgresql://injected.example/cce",
    );
  });

  it("passes root DATABASE_URL to migration configuration", async () => {
    delete process.env["DATABASE_URL"];
    const path = await writeEnvironment("DATABASE_URL=postgresql://root.example/cce\n");

    loadRepositoryEnvironment(path);

    expect(parseMigrationEnvironment(process.env).DATABASE_URL).toBe(
      "postgresql://root.example/cce",
    );
  });

  it("passes root seed identity and token values to seed configuration", async () => {
    for (const name of [
      "DATABASE_URL",
      "CCE_SEED_USER_EMAIL",
      "CCE_SEED_USER_NAME",
      "CCE_SEED_API_TOKEN",
    ]) {
      delete process.env[name];
    }
    const token = "test-seed-token-without-confidential-data";
    const path = await writeEnvironment(
      [
        "DATABASE_URL=postgresql://root.example/cce",
        "CCE_SEED_USER_EMAIL=developer@example.test",
        "CCE_SEED_USER_NAME=Developer",
        `CCE_SEED_API_TOKEN=${token}`,
      ].join("\n"),
    );

    loadRepositoryEnvironment(path);

    expect(parseSeedEnvironment(process.env)).toEqual({
      DATABASE_URL: "postgresql://root.example/cce",
      CCE_SEED_USER_EMAIL: "developer@example.test",
      CCE_SEED_USER_NAME: "Developer",
      CCE_SEED_API_TOKEN: token,
    });
  });

  it("rejects invalid loaded configuration without exposing secret values", async () => {
    const secret = "must-not-appear-in-validation-output";
    for (const name of [
      "DATABASE_URL",
      "CCE_SEED_USER_EMAIL",
      "CCE_SEED_USER_NAME",
      "CCE_SEED_API_TOKEN",
    ]) {
      delete process.env[name];
    }
    const path = await writeEnvironment(
      [
        "DATABASE_URL=",
        "CCE_SEED_USER_EMAIL=not-an-email",
        "CCE_SEED_USER_NAME=",
        `CCE_SEED_API_TOKEN=${secret}`,
      ].join("\n"),
    );
    loadRepositoryEnvironment(path);

    let failure: unknown;
    try {
      parseSeedEnvironment(process.env);
    } catch (error: unknown) {
      failure = error;
    }

    expect(failure).toBeInstanceOf(Error);
    expect(String(failure)).not.toContain(secret);
  });
});
