import {
  conversationPathParamsSchema,
  conversationResponseSchema,
  updateConversationBodySchema,
} from "@cce/api-contracts";
import type { NextRequest } from "next/server";

import {
  apiRoute,
  authenticateRequest,
  jsonSuccess,
  parseBody,
  parsePath,
} from "../../../../../../server/request";
import { getWebRuntime } from "../../../../../../server/runtime";

export const dynamic = "force-dynamic";

interface RouteContext {
  readonly params: Promise<{
    readonly projectId: string;
    readonly conversationId: string;
  }>;
}

export function GET(request: NextRequest, context: RouteContext): Promise<Response> {
  return apiRoute(async () => {
    const actor = await authenticateRequest(request);
    const path = parsePath(await context.params, conversationPathParamsSchema);
    const conversation = await getWebRuntime().conversations.get({
      ...path,
      actorUserId: actor.id,
    });
    return jsonSuccess(conversationResponseSchema, conversation);
  });
}

export function PATCH(request: NextRequest, context: RouteContext): Promise<Response> {
  return apiRoute(async () => {
    const actor = await authenticateRequest(request);
    const [path, body] = await Promise.all([
      context.params.then((params) => parsePath(params, conversationPathParamsSchema)),
      parseBody(request, updateConversationBodySchema),
    ]);
    const conversation = await getWebRuntime().conversations.update({
      ...path,
      actorUserId: actor.id,
      ...(body.title === undefined ? {} : { title: body.title }),
      ...(body.archive === undefined ? {} : { archive: body.archive }),
    });
    return jsonSuccess(conversationResponseSchema, conversation);
  });
}
