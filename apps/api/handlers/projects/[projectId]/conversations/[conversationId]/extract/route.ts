import {
  contextDeltaResponseSchema,
  conversationPathParamsSchema,
  createContextDeltaBodySchema,
} from "@cce/api-contracts";

import {
  apiRoute,
  authenticateRequest,
  jsonSuccess,
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

export function createHandlers(
  getRuntime: () => Pick<HttpServices, "extraction" | "sessions" | "sessionCookie">,
): { POST: (request: Request, context: RouteContext) => Promise<Response> } {
  function POST(request: Request, context: RouteContext): Promise<Response> {
    return apiRoute(async () => {
      const actor = await authenticateRequest(request, getRuntime());
      const [path, body] = await Promise.all([
        Promise.resolve().then(() => parsePath(context.params, conversationPathParamsSchema)),
        parseBody(request, createContextDeltaBodySchema),
      ]);
      const delta = await getRuntime().extraction.extract({
        ...path,
        actorUserId: actor.id,
        ...(body.throughMessageSequence === undefined
          ? {}
          : { throughMessageSequence: body.throughMessageSequence }),
        signal: request.signal,
      });
      return jsonSuccess(contextDeltaResponseSchema, delta, 201);
    });
  }

  return { POST };
}
