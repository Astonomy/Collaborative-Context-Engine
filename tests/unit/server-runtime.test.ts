import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { createApplicationRuntime } from "@cce/server-runtime";
import { createServerRuntime } from "../../apps/api/server/runtime";
import { userIdSchema } from "@cce/domain";
import { describe, expect, it, vi } from "vitest";
import { createFixture, seedConversation, uuid } from "./application/fixtures";

const environment = {
  DATABASE_URL: "postgresql://cce:unused@127.0.0.1:1/cce",
  NODE_ENV: "test",
  MODEL_BASE_URL: "http://127.0.0.1:1/v1",
  MODEL_API_KEY: "",
  MODEL_CHAT_MODEL: "chat",
  MODEL_EXTRACTOR_MODEL: "extractor",
  MODEL_CLASSIFIER_MODEL: "classifier",
  MODEL_RESOLVER_MODEL: "resolver",
  MODEL_REQUEST_TIMEOUT_MS: "1000",
};

const workingDirectory = resolve("apps/web");

describe("framework-neutral application composition", () => {
  it("instantiates and closes in a plain Node process without Next or DOM", () => {
    const script = `
      import { createApplicationRuntime } from '@cce/server-runtime';
      if (typeof window !== 'undefined' || typeof document !== 'undefined') throw new Error('DOM present');
      const runtime = createApplicationRuntime(${JSON.stringify(environment)}, ${JSON.stringify(workingDirectory)});
      if (runtime.pool.totalCount !== 0) throw new Error('eager connection');
      await runtime.close();
      console.log('closed');
    `;
    expect(
      execFileSync(process.execPath, ["--import", "tsx", "--input-type=module", "-e", script], {
        encoding: "utf8",
      }).trim(),
    ).toBe("closed");
    // A fresh tsx process loads the workspace graph; WSL coverage runs exceed five seconds.
  }, 30_000);

  it.each([
    { DATABASE_URL: "https://invalid.test" },
    { CCE_ATTACHMENT_STORAGE_DIRECTORY: "relative" },
    { NODE_ENV: "production" },
    { MODEL_REQUEST_TIMEOUT_MS: "0" },
    { MODEL_BASE_URL: "file:///model" },
  ])("rejects invalid server configuration before use: %j", (overrides) => {
    expect(() =>
      createApplicationRuntime({ ...environment, ...overrides }, workingDirectory),
    ).toThrow();
  });

  it("accepts explicit private production storage without HTTP session secrets", async () => {
    const runtime = createApplicationRuntime(
      {
        ...environment,
        NODE_ENV: "production",
        CCE_ATTACHMENT_STORAGE_DIRECTORY: resolve(".cce-attachments"),
      },
      workingDirectory,
    );
    await runtime.close();
  });

  it("preserves shared transaction wiring, context building and project RBAC", async () => {
    const runtime = createApplicationRuntime(environment, workingDirectory);
    const fixture = createFixture();
    const { conversation, message } = seedConversation(fixture);
    vi.spyOn(runtime.unitOfWork, "run").mockImplementation(
      fixture.unitOfWork.run.bind(fixture.unitOfWork),
    );
    try {
      expect(
        await runtime.contexts.listCommits({
          projectId: fixture.project.id,
          actorUserId: fixture.user.id,
        }),
      ).toEqual([fixture.genesis]);
      const pack = await runtime.contexts.buildForConversation({
        projectId: fixture.project.id,
        conversationId: conversation.id,
        actorUserId: fixture.user.id,
      });
      expect(pack.project.headCommitId).toBe(fixture.genesis.id);
      expect(pack.recentMessages).toEqual([message]);
      await expect(
        runtime.contexts.listCommits({
          projectId: fixture.project.id,
          actorUserId: userIdSchema.parse(uuid(999)),
        }),
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
      await expect(runtime.sessions.authenticateApiToken("invalid")).rejects.toMatchObject({
        code: "UNAUTHENTICATED",
      });
    } finally {
      vi.restoreAllMocks();
      await runtime.close();
    }
  });

  it("keeps HTTP cookie configuration in the existing API adapter", async () => {
    const runtime = createServerRuntime({ ...environment, CCE_SESSION_SECRET: "a".repeat(48) });
    try {
      expect(runtime.secureCookies).toBe(false);
      const token = "cce_" + "a".repeat(48);
      expect(runtime.sessionCookie.open(runtime.sessionCookie.seal(token))).toBe(token);
    } finally {
      await runtime.close();
    }
    expect(() => createServerRuntime(environment)).toThrow();
  });
});
