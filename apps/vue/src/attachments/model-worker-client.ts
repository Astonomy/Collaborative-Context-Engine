import type { ModelGeometry } from "./model-geometry";

export function inspectModel(bytes: ArrayBuffer, signal: AbortSignal): Promise<ModelGeometry> {
  return new Promise((resolve, reject) => {
    signal.throwIfAborted();
    const worker = new Worker(new URL("./model-worker.ts", import.meta.url), { type: "module" });
    const cleanup = (): void => {
      clearTimeout(timer);
      signal.removeEventListener("abort", abort);
      worker.terminate();
    };
    const abort = (): void => {
      cleanup();
      reject(new DOMException("Preview canceled.", "AbortError"));
    };
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error("Model preview timed out."));
    }, 2000);
    signal.addEventListener("abort", abort, { once: true });
    worker.onerror = (): void => {
      cleanup();
      reject(new Error("Model preview unavailable."));
    };
    worker.onmessage = (event: MessageEvent<unknown>): void => {
      cleanup();
      const data = event.data;
      if (
        typeof data !== "object" ||
        data === null ||
        !("triangles" in data) ||
        !(data.triangles instanceof ArrayBuffer) ||
        !("triangleCount" in data) ||
        typeof data.triangleCount !== "number" ||
        !Number.isInteger(data.triangleCount) ||
        data.triangleCount < 1 ||
        data.triangleCount > 20_000 ||
        data.triangles.byteLength !== data.triangleCount * 9 * 4
      ) {
        reject(new Error("Unsupported or invalid model preview."));
        return;
      }
      resolve({ triangles: new Float32Array(data.triangles), triangleCount: data.triangleCount });
    };
    worker.postMessage(bytes, [bytes]);
  });
}
