import { ApiClient } from "../data/api-client";

// Bound actual bytes even if Content-Length or the DTO is stale. Never retain a full video blob.
export async function readContent(
  path: string,
  limit: number,
  signal: AbortSignal,
  client = new ApiClient(),
): Promise<ArrayBuffer> {
  const response = await client.request(path, { signal });
  if (!response.body) throw new Error("Attachment content is unavailable.");
  const reader = response.body.getReader();
  const parts: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const next = await reader.read();
      signal.throwIfAborted();
      if (next.done) break;
      size += next.value.byteLength;
      if (size > limit) throw new Error("Attachment exceeds preview limit.");
      parts.push(next.value);
    }
  } finally {
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const part of parts) {
    bytes.set(part, offset);
    offset += part.length;
  }
  return bytes.buffer;
}
