import {
  apiErrorResponseSchema,
  chatStreamEventSchema,
  conversationPathParamsSchema,
  createChatBodySchema,
} from "@cce/api-contracts";
import { ApplicationError, type ChatEvent } from "@cce/application";
import type { NextRequest } from "next/server";

import {
  apiRoute,
  authenticateRequest,
  errorResponse,
  parseBody,
  parsePath,
} from "../../../../../../../server/request";
import { getWebRuntime } from "../../../../../../../server/runtime";

export const dynamic = "force-dynamic";

interface RouteContext {
  readonly params: Promise<{
    readonly projectId: string;
    readonly conversationId: string;
  }>;
}

const encoder = new TextEncoder();

function encodeEvent(event: ChatEvent): Uint8Array {
  const checked = chatStreamEventSchema.parse(event);
  return encoder.encode(`event: ${checked.type}\ndata: ${JSON.stringify(checked)}\n\n`);
}

export function POST(request: NextRequest, context: RouteContext): Promise<Response> {
  return apiRoute(async (requestId) => {
    const actor = await authenticateRequest(request);
    const [path, body] = await Promise.all([
      context.params.then((params) => parsePath(params, conversationPathParamsSchema)),
      parseBody(request, createChatBodySchema),
    ]);
    const streamAbort = new AbortController();
    const events = getWebRuntime().chat.chat({
      ...path,
      actorUserId: actor.id,
      ...body,
      signal: AbortSignal.any([request.signal, streamAbort.signal]),
    });
    const iterator = events[Symbol.asyncIterator]();

    const first = await iterator.next();
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
        try {
          controller.enqueue(encodeEvent(first.value));
          while (true) {
            const next = await iterator.next();
            if (next.done) {
              break;
            }
            controller.enqueue(encodeEvent(next.value));
          }
        } catch (error: unknown) {
          streamAbort.abort();
          if (!request.signal.aborted) {
            const failure = errorResponse(error, requestId);
            const payload = apiErrorResponseSchema.parse(await failure.json());
            controller.enqueue(
              encoder.encode(`event: error\ndata: ${JSON.stringify(payload)}\n\n`),
            );
          }
        } finally {
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
