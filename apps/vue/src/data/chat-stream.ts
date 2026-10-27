import {
  chatStreamEventSchema,
  createChatBodySchema,
  type ChatStreamEvent,
  type CreateChatBody,
} from "@cce/api-contracts";
import { ApiClient, requireSuccess } from "./api-client";

// ConversationView imports this module dynamically when chat starts.
// POST streams are never retried automatically: interruption may already have persisted evidence.
export async function streamChat(
  path: string,
  body: CreateChatBody,
  onEvent: (event: ChatStreamEvent) => void,
  signal: AbortSignal,
  transport: typeof fetch = fetch,
  client = new ApiClient(transport),
  timeoutMs = 300_000,
): Promise<void> {
  signal = AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)]);
  signal.throwIfAborted();
  const response = await client.request(path, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "text/event-stream" },
    cache: "no-store",
    redirect: "error",
    body: JSON.stringify(createChatBodySchema.parse(body)),
    signal,
  });
  await requireSuccess(response);
  if (!response.headers.get("content-type")?.startsWith("text/event-stream") || !response.body)
    throw new Error("Expected a chat event stream.");
  const reader = response.body.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let buffer = "";
  let completed = false;
  const abort = (): void => {
    void reader.cancel().catch(() => undefined);
  };
  signal.addEventListener("abort", abort, { once: true });
  const consume = async (block: string): Promise<void> => {
    signal.throwIfAborted();
    const lines = block.split(/\r?\n/);
    const data = lines
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).trimStart())
      .join("\n");
    if (!data) return;
    const payload: unknown = JSON.parse(data);
    if (lines.some((line) => /^event:\s*error\s*$/.test(line)))
      await requireSuccess(Response.json(payload, { status: 503 }));
    const event = chatStreamEventSchema.parse(payload);
    if (completed) throw new Error("Chat emitted data after completion.");
    completed = event.type === "completed";
    onEvent(event);
  };
  try {
    while (true) {
      signal.throwIfAborted();
      const chunk = await reader.read();
      signal.throwIfAborted();
      buffer += decoder.decode(chunk.value, { stream: !chunk.done });
      const blocks = buffer.split(/\r?\n\r?\n/);
      buffer = blocks.pop() ?? "";
      for (const block of blocks) {
        if (block.length > 8 * 1024 * 1024) throw new Error("Chat event exceeds limit.");
        await consume(block);
      }
      if (completed) return;
      if (buffer.length > 8 * 1024 * 1024) throw new Error("Chat event exceeds limit.");
      if (chunk.done) {
        if (buffer.trim()) await consume(buffer);
        if (!completed) throw new Error("Chat stream ended before completion.");
        return;
      }
    }
  } finally {
    signal.removeEventListener("abort", abort);
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}
