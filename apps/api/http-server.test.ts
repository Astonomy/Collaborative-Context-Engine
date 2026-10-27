import { once } from "node:events";
import { afterEach, expect, it, vi } from "vitest";
import { createStandaloneServer } from "./http-server";
import { assertSameOrigin } from "@cce/server-runtime";
vi.mock("next/server", () => {
  throw new Error("Next runtime must not load");
});
const servers: ReturnType<typeof createStandaloneServer>[] = [];
it.each(["https://cce.example.test", "https://foreign.example.test"])(
  "preserves cookie origin enforcement behind HTTPS ingress for %s",
  async (origin) => {
    const server = createStandaloneServer(
      async (request) => {
        try {
          assertSameOrigin(request);
          return new Response(null, { status: 204 });
        } catch {
          return new Response(null, { status: 403 });
        }
      },
      { publicOrigin: "https://cce.example.test" },
    );
    servers.push(server);
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Missing listener");
    const response = await fetch(`http://127.0.0.1:${address.port}/api/session`, {
      method: "POST",
      headers: { origin, "x-forwarded-host": "foreign.example.test", "x-forwarded-proto": "https" },
    });
    expect(response.status).toBe(origin === "https://cce.example.test" ? 204 : 403);
  },
);
it.each([
  "https://user:secret@cce.test",
  "https://cce.test/api",
  "https://cce.test?token=secret",
  "file:///tmp",
])("rejects invalid public API origin %s", (publicOrigin) => {
  expect(() => createStandaloneServer(async () => new Response(), { publicOrigin })).toThrow();
});
afterEach(async () => {
  for (const server of servers.splice(0)) {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
});
it("bridges binary request and response streams over real HTTP without Next", async () => {
  const server = createStandaloneServer(
    async (request) =>
      new Response(request.body, {
        status: 206,
        headers: {
          "content-type": "video/mp4",
          "content-range": "bytes 0-3/8",
          "content-length": "4",
          "accept-ranges": "bytes",
        },
      }),
  );
  servers.push(server);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Missing listener");
  const response = await fetch(`http://127.0.0.1:${address.port}/api/content`, {
    method: "POST",
    body: new Uint8Array([0, 1, 2, 3]),
  });
  expect(response.status).toBe(206);
  expect(response.headers.get("content-type")).toBe("video/mp4");
  expect(response.headers.get("content-range")).toBe("bytes 0-3/8");
  expect(new Uint8Array(await response.arrayBuffer())).toEqual(new Uint8Array([0, 1, 2, 3]));
});
it("contains handler failures without exposing internal errors", async () => {
  const server = createStandaloneServer(() => Promise.reject(new Error("private-path")));
  servers.push(server);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Missing listener");
  const response = await fetch(`http://127.0.0.1:${address.port}/api/content`);
  expect(response.status).toBe(500);
  expect(await response.text()).not.toContain("private-path");
});

it.each(["disconnect", "shutdown", "timeout"] as const)(
  "cancels pending SSE reads on %s without Next",
  async (reason) => {
    const cancelled = vi.fn();
    let signal: AbortSignal | undefined;
    const server = createStandaloneServer(
      async (request) => {
        signal = request.signal;
        return new Response(
          new ReadableStream({
            start(controller) {
              controller.enqueue(
                new TextEncoder().encode(
                  'event: text_delta\ndata: {"type":"text_delta","text":"one"}\n\n',
                ),
              );
            },
            cancel: cancelled,
          }),
          { headers: { "content-type": "text/event-stream" } },
        );
      },
      { requestTimeoutMs: reason === "timeout" ? 100 : 5_000 },
    );
    servers.push(server);
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Missing listener");
    const controller = new AbortController();
    const response = await fetch(`http://127.0.0.1:${address.port}/api/chat`, {
      signal: controller.signal,
    });
    const reader = response.body?.getReader();
    expect(new TextDecoder().decode((await reader?.read())?.value)).toContain("text_delta");
    if (reason === "disconnect") controller.abort();
    if (reason === "shutdown") {
      await server.shutdown();
      servers.splice(servers.indexOf(server), 1);
    }
    await expect.poll(() => signal?.aborted).toBe(true);
    await expect.poll(() => cancelled.mock.calls.length).toBe(1);
    await reader?.cancel().catch(() => undefined);
  },
);
