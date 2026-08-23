import {
  contextDeltaResponseSchema,
  conversationPathParamsSchema,
  createContextDeltaBodySchema,
} from "@cce/api-contracts";
import type { NextRequest } from "next/server";

import {
  apiRoute,
  authenticateRequest,
  jsonSuccess,
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

export function POST(request: NextRequest, context: RouteContext): Promise<Response> {
  return apiRoute(async () => {
    const actor = await authenticateRequest(request);
    const [path, body] = await Promise.all([
      context.params.then((params) => parsePath(params, conversationPathParamsSchema)),
      parseBody(request, createContextDeltaBodySchema),
    ]);
    const delta = await getWebRuntime().extraction.extract({
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
