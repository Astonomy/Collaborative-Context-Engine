import { afterEach, expect, it, vi } from "vitest";
import { glbFixture } from "./fixtures";
afterEach(() => {
  self.onmessage = null;
  vi.restoreAllMocks();
});
it("worker accepts bytes only, transfers geometry and sanitizes parse failures", async () => {
  const post = vi.spyOn(self, "postMessage").mockImplementation(() => undefined);
  await import("./model-worker");
  self.onmessage?.call(self, new MessageEvent("message", { data: "https://untrusted.test/model" }));
  expect(post).not.toHaveBeenCalled();
  self.onmessage?.call(self, new MessageEvent("message", { data: glbFixture() }));
  expect(post).toHaveBeenCalledTimes(1);
  const payload: unknown = post.mock.calls[0]?.[0];
  expect(payload).toHaveProperty("triangleCount", 1);
  expect(payload).toHaveProperty("triangles");
  expect(post.mock.calls[0]?.[1]).toHaveProperty("transfer");
  self.onmessage?.call(self, new MessageEvent("message", { data: new ArrayBuffer(4) }));
  expect(post).toHaveBeenLastCalledWith({ error: "Unsupported or invalid model preview." });
});
