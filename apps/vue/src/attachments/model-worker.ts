import { parseModel } from "./model-geometry";

// The worker receives only uploaded bytes, never URLs, cookies, tokens or storage locators.
self.onmessage = (event: MessageEvent<unknown>): void => {
  if (!(event.data instanceof ArrayBuffer)) return;
  try {
    const geometry = parseModel(event.data);
    self.postMessage(
      { triangles: geometry.triangles.buffer, triangleCount: geometry.triangleCount },
      { transfer: [geometry.triangles.buffer] },
    );
  } catch {
    self.postMessage({ error: "Unsupported or invalid model preview." });
  }
};
