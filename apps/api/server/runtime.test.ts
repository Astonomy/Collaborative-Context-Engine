import { resolve } from "node:path";
import { expect, it, vi } from "vitest";
import type { AttachmentStorage } from "@cce/application";
import { createServerRuntime } from "./runtime";

const roots = vi.hoisted(() => new Array<string>());
vi.mock("@cce/storage", () => ({
  LocalAttachmentStorage: class implements AttachmentStorage {
    constructor(root: string) {
      roots.push(root);
    }
    put(): ReturnType<AttachmentStorage["put"]> {
      return Promise.reject(new Error("unused"));
    }
    open(): ReturnType<AttachmentStorage["open"]> {
      return Promise.reject(new Error("unused"));
    }
  },
}));

it("uses the same private development storage for API and existing web hosts", async () => {
  const environment = {
    DATABASE_URL: "postgresql://cce:unused@127.0.0.1:1/cce",
    NODE_ENV: "test",
    CCE_SESSION_SECRET: "a".repeat(48),
    MODEL_BASE_URL: "http://127.0.0.1:1/v1",
    MODEL_API_KEY: "",
    MODEL_CHAT_MODEL: "chat",
    MODEL_EXTRACTOR_MODEL: "extractor",
    MODEL_CLASSIFIER_MODEL: "classifier",
    MODEL_RESOLVER_MODEL: "resolver",
    MODEL_REQUEST_TIMEOUT_MS: "1000",
  };
  const api = createServerRuntime(environment, resolve("apps/api"));
  const web = createServerRuntime(environment, resolve("apps/web"));
  try {
    expect(roots.slice(-2)).toEqual([resolve(".cce-attachments"), resolve(".cce-attachments")]);
  } finally {
    await api.close();
    await web.close();
  }
});
