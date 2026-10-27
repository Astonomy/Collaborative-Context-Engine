import { randomBytes, randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { once } from "node:events";
import { PostgreSqlContainer } from "@testcontainers/postgresql";
import {
  createPostgresPool,
  PostgresUnitOfWork,
  runMigrations,
  seedDevelopmentIdentity,
} from "@cce/database";

const mode = process.argv[2];
if (!["integration", "e2e", "vue", "attachments", "decoupling"].includes(mode ?? ""))
  throw new Error("Expected integration, e2e, vue, attachments or decoupling.");
const databaseName = `cce_test_${randomUUID().replaceAll("-", "")}`;
const maintenance = process.env["TEST_DATABASE_URL"] || undefined;
if (maintenance && new URL(maintenance).pathname !== "/postgres") {
  throw new Error("TEST_DATABASE_URL must address the postgres maintenance database.");
}
const container = maintenance
  ? undefined
  : await new PostgreSqlContainer("postgres:18.6-alpine3.24").start();
const maintenanceUrl = maintenance ?? container?.getConnectionUri();
if (!maintenanceUrl) throw new Error("No test PostgreSQL available");
const admin = createPostgresPool(maintenanceUrl);
const storage = await mkdtemp(join(tmpdir(), "cce-s8-"));
let created = false;
let model: ReturnType<typeof spawn> | undefined;
try {
  await admin.query(`CREATE DATABASE "${databaseName}"`);
  created = true;
  const url = new URL(maintenanceUrl);
  url.pathname = `/${databaseName}`;
  const databaseUrl = url.toString();
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    DATABASE_URL: databaseUrl,
    CCE_TEST_DATABASE_URL: databaseUrl,
  };
  if (mode !== "integration") {
    const pool = createPostgresPool(databaseUrl);
    try {
      console.log("Empty-database migrations:", await runMigrations(pool));
      const unit = new PostgresUnitOfWork(pool);
      for (const [key, email] of [
        ["CCE_E2E_API_TOKEN", "e2e-alice@example.test"],
        ["CCE_E2E_EDITOR_API_TOKEN", "e2e-bob@example.test"],
        ["CCE_E2E_VIEWER_API_TOKEN", "e2e-viewer@example.test"],
      ]) {
        if (!key || !email) throw new Error("Invalid identity configuration");
        const token = randomBytes(32).toString("hex");
        env[key] = token;
        await seedDevelopmentIdentity(unit, { email, displayName: email, apiToken: token });
      }
    } finally {
      await pool.end();
    }
    const modelPort = process.env["CCE_TEST_MODEL_PORT"] ?? "18080";
    Object.assign(env, {
      CCE_SESSION_SECRET: randomBytes(32).toString("hex"),
      CCE_ATTACHMENT_STORAGE_DIRECTORY: storage,
      MODEL_BASE_URL: `http://127.0.0.1:${modelPort}/v1`,
      MODEL_E2E_PORT: modelPort,
      MODEL_API_KEY: "isolated-test-only",
      MODEL_CHAT_MODEL: "e2e",
      MODEL_EXTRACTOR_MODEL: "e2e",
      MODEL_CLASSIFIER_MODEL: "e2e",
      MODEL_RESOLVER_MODEL: "e2e",
    });
    model = spawn(process.execPath, ["scripts/e2e-model-server.mjs"], {
      env,
      stdio: ["ignore", "pipe", "inherit"],
    });
    if (!model.stdout) throw new Error("Test model stdout is unavailable");
    await Promise.race([
      once(model.stdout, "data"),
      once(model, "exit").then(() => {
        throw new Error("Test model failed to start");
      }),
    ]);
  }
  const args =
    mode === "integration"
      ? ["node_modules/vitest/vitest.mjs", "run", "--config", "vitest.integration.config.ts"]
      : [
          "node_modules/@playwright/test/cli.js",
          "test",
          ...(mode === "vue" ? ["--config", "apps/vue/playwright.config.ts"] : []),
          ...(mode === "attachments"
            ? ["--config", "apps/vue/playwright.standalone.config.ts"]
            : []),
          ...(mode === "decoupling" ? ["--config", "playwright.decoupling.config.ts"] : []),
        ];
  const child = spawn(process.execPath, args, { env, stdio: "inherit" });
  const code = await new Promise<number | null>((resolve, reject) => {
    child.once("exit", resolve);
    child.once("error", reject);
  });
  process.exitCode = typeof code === "number" ? code : 1;
} finally {
  if (model && model.exitCode === null) {
    model.kill();
    await once(model, "exit");
  }
  if (created) await admin.query(`DROP DATABASE "${databaseName}" WITH (FORCE)`);
  await admin.end();
  await container?.stop();
  await rm(storage, { recursive: true, force: true });
}
