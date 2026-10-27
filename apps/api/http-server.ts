import { resolve } from "node:path";
import { createServer, type Server, type IncomingMessage, type ServerResponse } from "node:http";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { z } from "zod";
import { createApiRouter } from "./router";
import { getServerRuntime } from "./server/runtime";

export interface StandaloneServer extends Server {
  shutdown(): Promise<void>;
}

export function createStandaloneServer(
  handle: (request: Request) => Promise<Response>,
  options: { requestTimeoutMs?: number; publicOrigin?: string } = {},
): StandaloneServer {
  const publicOrigin =
    options.publicOrigin === undefined
      ? undefined
      : z
          .url()
          .refine((value) => {
            const url = new URL(value);
            return (
              ["http:", "https:"].includes(url.protocol) &&
              !url.username &&
              !url.password &&
              url.pathname === "/" &&
              !url.search &&
              !url.hash
            );
          })
          .transform((value) => new URL(value).origin)
          .parse(options.publicOrigin);
  const timeoutMs = z
    .number()
    .int()
    .positive()
    .parse(options.requestTimeoutMs ?? 300_000);
  const active = new Set<AbortController>();
  const pending = new Set<Promise<void>>();
  let stopping = false;
  async function serve(incoming: IncomingMessage, outgoing: ServerResponse): Promise<void> {
    const controller = new AbortController();
    active.add(controller);
    const abort = (): void => {
      controller.abort();
    };
    outgoing.once("close", abort);
    const timeout = setTimeout(() => {
      controller.abort(new DOMException("API request timed out", "TimeoutError"));
      outgoing.destroy();
    }, timeoutMs);
    timeout.unref();
    try {
      const headers = new Headers();
      for (const [name, value] of Object.entries(incoming.headers)) {
        if (Array.isArray(value)) value.forEach((item) => headers.append(name, item));
        else if (value !== undefined) headers.set(name, value);
      }
      const method = incoming.method ?? "GET";
      // A configured ingress origin handles TLS termination without trusting forwarded headers.
      if (publicOrigin) headers.set("host", new URL(publicOrigin).host);
      const init: RequestInit & { duplex: "half" } = {
        method,
        headers,
        signal: controller.signal,
        duplex: "half",
      };
      if (method !== "GET" && method !== "HEAD") {
        const iterator = incoming[Symbol.asyncIterator]();
        init.body = new ReadableStream<Uint8Array>({
          async pull(stream) {
            const next: IteratorResult<unknown> = await iterator.next();
            if (next.done) stream.close();
            else if (next.value instanceof Uint8Array) stream.enqueue(next.value);
            else stream.error(new Error("Invalid request stream"));
          },
          async cancel() {
            await iterator.return?.();
          },
        });
      }
      const request = new Request(
        `${publicOrigin ?? `http://${headers.get("host") ?? "localhost"}`}${incoming.url ?? "/"}`,
        init,
      );
      const response = await handle(request);
      outgoing.writeHead(response.status, Object.fromEntries(response.headers));
      if (!response.body) {
        outgoing.end();
        return;
      }
      const reader = response.body.getReader();
      const cancel = (): void => {
        void reader.cancel(controller.signal.reason).catch(() => undefined);
      };
      controller.signal.addEventListener("abort", cancel, { once: true });
      if (controller.signal.aborted) cancel();
      async function* chunks(): AsyncIterable<Uint8Array> {
        try {
          while (true) {
            const next = await reader.read();
            if (next.done) return;
            yield next.value;
          }
        } finally {
          controller.signal.removeEventListener("abort", cancel);
          await reader.cancel().catch(() => undefined);
          reader.releaseLock();
        }
      }
      await pipeline(Readable.from(chunks()), outgoing, { signal: controller.signal });
    } catch {
      if (outgoing.headersSent) outgoing.destroy();
      else {
        outgoing.writeHead(500);
        outgoing.end();
      }
    } finally {
      clearTimeout(timeout);
      outgoing.removeListener("close", abort);
      active.delete(controller);
    }
  }
  const server = createServer((incoming, outgoing) => {
    if (stopping) {
      outgoing.writeHead(503);
      outgoing.end();
      return;
    }
    const task = serve(incoming, outgoing);
    pending.add(task);
    void task.finally(() => pending.delete(task));
  });
  let shutdown: Promise<void> | undefined;
  return Object.assign(server, {
    shutdown(): Promise<void> {
      shutdown ??= (async () => {
        stopping = true;
        const closed = new Promise<void>((resolve, reject) =>
          server.close((error) => (error ? reject(error) : resolve())),
        );
        for (const controller of active) controller.abort();
        server.closeAllConnections();
        await Promise.all([closed, ...pending]);
      })();
      return shutdown;
    },
  });
}

export function startStandaloneApi(): StandaloneServer {
  const port = z.coerce
    .number()
    .int()
    .min(1)
    .max(65535)
    .parse(process.env["CCE_API_PORT"] ?? "3001");
  const server = createStandaloneServer(
    createApiRouter(() => getServerRuntime(resolve(process.cwd(), "apps/api"))),
    !process.env["CCE_API_PUBLIC_ORIGIN"]
      ? {}
      : { publicOrigin: process.env["CCE_API_PUBLIC_ORIGIN"] },
  );
  const host = z
    .enum(["127.0.0.1", "0.0.0.0", "::1", "::"])
    .parse(process.env["CCE_API_HOST"] ?? "127.0.0.1");
  server.listen(port, host, () => console.log(`CCE API listening on ${port}`));
  return server;
}
