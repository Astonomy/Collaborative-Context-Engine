// @vitest-environment node
import { expect, it, vi } from "vitest";
import { streamChat } from "./chat-stream";
import { ApiClient } from "./api-client";

const body = { clientMessageId: "00000000-0000-4000-8000-000000000001", content: "Hello" };
const message = {
  id: body.clientMessageId,
  projectId: body.clientMessageId,
  conversationId: body.clientMessageId,
  sequence: 2,
  role: "assistant",
  author: { type: "model", provider: "test", model: "test", runId: body.clientMessageId },
  content: "你好",
  deliveryState: "completed",
  clientMessageId: null,
  providerMessageId: null,
  errorCode: null,
  completedAt: "2026-01-01T00:00:00.000Z",
  createdAt: "2026-01-01T00:00:00.000Z",
};
const event = (data: unknown): string => `data: ${JSON.stringify(data)}\r\n\r\n`;
it("streams from the standalone API with shared credentials", async () => {
  const transport = vi
    .fn<typeof fetch>()
    .mockResolvedValue(response(event({ type: "completed", message })));
  const client = new ApiClient(transport, undefined, "https://api.example.test");
  await streamChat(
    "/api/projects/p/conversations/c/chat",
    body,
    vi.fn(),
    new AbortController().signal,
    transport,
    client,
  );
  expect(transport).toHaveBeenCalledWith(
    "https://api.example.test/api/projects/p/conversations/c/chat",
    expect.objectContaining({ credentials: "include" }),
  );
});
function response(text: string): Response {
  const bytes = new TextEncoder().encode(text);
  return new Response(
    new ReadableStream<Uint8Array>({
      start(controller) {
        for (const byte of bytes) controller.enqueue(Uint8Array.of(byte));
        controller.close();
      },
    }),
    { headers: { "content-type": "text/event-stream" } },
  );
}
it("handles split UTF-8 and CRLF frames with validated terminal events", async () => {
  const onEvent = vi.fn();
  const transport = vi
    .fn<typeof fetch>()
    .mockResolvedValue(
      response(
        ":heartbeat\r\n\r\n" +
          event({ type: "text_delta", text: "你好" }) +
          event({ type: "completed", message }),
      ),
    );
  await streamChat(
    "/api/projects/p/conversations/c/chat",
    body,
    onEvent,
    new AbortController().signal,
    transport,
  );
  expect(onEvent).toHaveBeenCalledTimes(2);
  expect(onEvent).toHaveBeenNthCalledWith(1, { type: "text_delta", text: "你好" });
  expect(transport).toHaveBeenCalledTimes(1);
});
it.each([
  "",
  'data: {"type":"text_delta","text":"x"}\n\n',
  'data: {"type":"unknown"}\n\n',
  'event: error\ndata: {"error":{"code":"DEPENDENCY_UNAVAILABLE","message":"Unavailable"}}\n\n',
  "data: not-json\n\n",
])("rejects incomplete, invalid and server-error streams without retry", async (text) => {
  const transport = vi.fn<typeof fetch>().mockResolvedValue(response(text));
  await expect(
    streamChat("/api/projects/p/chat", body, vi.fn(), new AbortController().signal, transport),
  ).rejects.toThrow();
  expect(transport).toHaveBeenCalledTimes(1);
});
it("cancels its reader on abort and never publishes late events", async () => {
  const cancel = vi.fn();
  const controller = new AbortController();
  const transport = vi.fn<typeof fetch>().mockResolvedValue(
    new Response(new ReadableStream({ cancel }), {
      headers: { "content-type": "text/event-stream" },
    }),
  );
  const callback = vi.fn();
  const pending = streamChat("/api/projects/p/chat", body, callback, controller.signal, transport);
  await new Promise((resolve) => setTimeout(resolve, 0));
  controller.abort();
  await expect(pending).rejects.toMatchObject({ name: "AbortError" });
  expect(cancel).toHaveBeenCalledOnce();
  expect(callback).not.toHaveBeenCalled();
});
it("rejects a non-stream response", async () => {
  await expect(
    streamChat(
      "/api/projects/p/chat",
      body,
      vi.fn(),
      new AbortController().signal,
      vi.fn<typeof fetch>().mockResolvedValue(Response.json({})),
    ),
  ).rejects.toThrow("Expected");
});

it("finishes on the terminal event even when the server keeps the connection open", async () => {
  const cancel = vi.fn();
  const transport = vi.fn<typeof fetch>().mockResolvedValue(
    new Response(
      new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode(event({ type: "completed", message })));
        },
        cancel,
      }),
      { headers: { "content-type": "text/event-stream" } },
    ),
  );
  await streamChat("/api/projects/p/chat", body, vi.fn(), new AbortController().signal, transport);
  expect(cancel).toHaveBeenCalledOnce();
});

it("times out a stalled stream and cancels the reader", async () => {
  const cancel = vi.fn();
  const transport = vi.fn<typeof fetch>().mockResolvedValue(
    new Response(new ReadableStream({ cancel }), {
      headers: { "content-type": "text/event-stream" },
    }),
  );
  await expect(
    streamChat(
      "/api/projects/p/chat",
      body,
      vi.fn(),
      new AbortController().signal,
      transport,
      new ApiClient(transport),
      20,
    ),
  ).rejects.toMatchObject({ name: "TimeoutError" });
  expect(cancel).toHaveBeenCalledOnce();
});
