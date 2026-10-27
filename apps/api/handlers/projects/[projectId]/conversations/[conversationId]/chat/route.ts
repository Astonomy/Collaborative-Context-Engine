import {
  apiErrorResponseSchema,
  chatStreamEventSchema,
  conversationPathParamsSchema,
  createChatBodySchema,
} from "@cce/api-contracts";
import { ApplicationError, type ChatEvent } from "@cce/application";

import {
  apiRoute,
  authenticateRequest,
  errorResponse,
  parseBody,
  parsePath,
} from "../../../../../../server/request";
import type { HttpServices } from "../../../../../../server/services";

interface RouteContext {
  readonly params: {
    readonly projectId: string;
    readonly conversationId: string;
  };
}

const encoder = new TextEncoder();

function encodeEvent(event: ChatEvent): Uint8Array {
  const checked = chatStreamEventSchema.parse(event);
  return encoder.encode(`event: ${checked.type}\ndata: ${JSON.stringify(checked)}\n\n`);
}

export function createHandlers(
  getRuntime: () => Pick<HttpServices, "chat" | "sessions" | "sessionCookie">,
): { POST: (request: Request, context: RouteContext) => Promise<Response> } {
  function POST(request: Request, context: RouteContext): Promise<Response> {
    return apiRoute(async (requestId) => {
      const actor = await authenticateRequest(request, getRuntime());
      const [path, body] = await Promise.all([
        Promise.resolve().then(() => parsePath(context.params, conversationPathParamsSchema)),
        parseBody(request, createChatBodySchema),
      ]);
      const streamAbort = new AbortController();
      const events = getRuntime().chat.chat({
        ...path,
        actorUserId: actor.id,
        ...body,
        signal: AbortSignal.any([request.signal, streamAbort.signal]),
      });
      const iterator = events[Symbol.asyncIterator]();

      let first: IteratorResult<ChatEvent>;
      try {
        first = await iterator.next();
      } catch (error: unknown) {
        streamAbort.abort();
        await iterator.return?.();
        throw error;
      }
      if (first.done) {
        throw new ApplicationError("DEPENDENCY_UNAVAILABLE", "Chat stream produced no events.");
      }
      let iteratorClosed = false;
      const closeIterator = async (): Promise<void> => {
        if (iteratorClosed) return;
        iteratorClosed = true;
        await iterator.return?.();
      };

      const stream = new ReadableStream<Uint8Array>({
        async start(controller) {
          const abort = (): void => {
            streamAbort.abort();
            controller.error(request.signal.reason);
          };
          request.signal.addEventListener("abort", abort, { once: true });
          try {
            request.signal.throwIfAborted();
            controller.enqueue(encodeEvent(first.value));
            let terminal = first.value.type === "completed";
            while (!terminal) {
              const next = await iterator.next();
              if (next.done) {
                break;
              }
              controller.enqueue(encodeEvent(next.value));
              terminal = next.value.type === "completed";
            }
          } catch (error: unknown) {
            const cancelled = request.signal.aborted || streamAbort.signal.aborted;
            streamAbort.abort();
            if (!cancelled) {
              const failure = errorResponse(error, requestId);
              const payload = apiErrorResponseSchema.parse(await failure.json());
              controller.enqueue(
                encoder.encode(`event: error\ndata: ${JSON.stringify(payload)}\n\n`),
              );
            }
          } finally {
            request.signal.removeEventListener("abort", abort);
            await closeIterator();
            if (!request.signal.aborted) {
              try {
                controller.close();
              } catch {
                // The consumer may already have cancelled the stream.
              }
            }
          }
        },
        async cancel() {
          streamAbort.abort();
          await closeIterator();
        },
      });

      return new Response(stream, {
        status: 200,
        headers: {
          "cache-control": "no-cache, no-transform",
          connection: "keep-alive",
          "content-type": "text/event-stream; charset=utf-8",
          "x-accel-buffering": "no",
        },
      });
    });
  }

  return { POST };
}
