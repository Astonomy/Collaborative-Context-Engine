import {
  appendMessageBodySchema,
  conversationPathParamsSchema,
  messageListResponseSchema,
  messageResponseSchema,
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

export function GET(request: NextRequest, context: RouteContext): Promise<Response> {
  return apiRoute(async () => {
    const actor = await authenticateRequest(request);
    const path = parsePath(await context.params, conversationPathParamsSchema);
    const messages = await getWebRuntime().conversations.listMessages({
      ...path,
      actorUserId: actor.id,
    });
    return jsonSuccess(messageListResponseSchema, messages);
  });
}

export function POST(request: NextRequest, context: RouteContext): Promise<Response> {
  return apiRoute(async () => {
    const actor = await authenticateRequest(request);
    const [path, body] = await Promise.all([
      context.params.then((params) => parsePath(params, conversationPathParamsSchema)),
      parseBody(request, appendMessageBodySchema),
    ]);
    const message = await getWebRuntime().conversations.appendUserMessage({
      ...path,
      actorUserId: actor.id,
      ...body,
    });
    return jsonSuccess(messageResponseSchema, message, 201);
  });
}
