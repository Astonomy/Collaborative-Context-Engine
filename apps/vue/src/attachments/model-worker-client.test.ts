import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { inspectModel } from "./model-worker-client";
class PreviewWorker {
  static latest: PreviewWorker;
  constructor() {
    PreviewWorker.latest = this;
  }
  terminate = vi.fn();
  postMessage = vi.fn();
  onmessage?: (event: MessageEvent<unknown>) => void;
  onerror?: () => void;
}
beforeEach(() => vi.stubGlobal("Worker", PreviewWorker));
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});
it("transfers only bytes to the isolated parser and terminates after numeric output", async () => {
  const bytes = new ArrayBuffer(12);
  const result = inspectModel(bytes, new AbortController().signal);
  const worker = PreviewWorker.latest;
  expect(worker.postMessage).toHaveBeenCalledWith(bytes, [bytes]);
  worker.onmessage?.(
    new MessageEvent("message", { data: { triangles: new ArrayBuffer(36), triangleCount: 1 } }),
  );
  expect((await result).triangleCount).toBe(1);
  expect(worker.terminate).toHaveBeenCalledOnce();
});
it.each([
  null,
  { error: "bad model" },
  { triangles: new ArrayBuffer(4), triangleCount: 1 },
  { triangles: new ArrayBuffer(0), triangleCount: 0 },
])("rejects invalid worker output", async (data) => {
  const result = inspectModel(new ArrayBuffer(4), new AbortController().signal);
  const checked = expect(result).rejects.toThrow("invalid");
  PreviewWorker.latest.onmessage?.(new MessageEvent("message", { data }));
  await checked;
  expect(PreviewWorker.latest.terminate).toHaveBeenCalled();
});
it("terminates on timeout, error, cancellation and avoids creating already-aborted work", async () => {
  vi.useFakeTimers();
  const result = inspectModel(new ArrayBuffer(4), new AbortController().signal);
  const checked = expect(result).rejects.toThrow("timed out");
  await vi.advanceTimersByTimeAsync(2000);
  await checked;
  expect(PreviewWorker.latest.terminate).toHaveBeenCalled();
  const failure = inspectModel(new ArrayBuffer(4), new AbortController().signal);
  const failureCheck = expect(failure).rejects.toThrow("unavailable");
  PreviewWorker.latest.onerror?.();
  await failureCheck;
  const controller = new AbortController();
  const canceled = inspectModel(new ArrayBuffer(4), controller.signal);
  const cancelCheck = expect(canceled).rejects.toMatchObject({ name: "AbortError" });
  controller.abort();
  await cancelCheck;
  expect(PreviewWorker.latest.terminate).toHaveBeenCalled();
  await expect(inspectModel(new ArrayBuffer(4), controller.signal)).rejects.toMatchObject({
    name: "AbortError",
  });
});
