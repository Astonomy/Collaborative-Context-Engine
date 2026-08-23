import {
  conversationListResponseSchema,
  conversationResponseSchema,
  createConversationBodySchema,
  projectPathParamsSchema,
} from "@cce/api-contracts";
import type { NextRequest } from "next/server";

import {
  apiRoute,
  authenticateRequest,
  jsonSuccess,
  parseBody,
  parsePath,
} from "../../../../../server/request";
import { getWebRuntime } from "../../../../../server/runtime";

export const dynamic = "force-dynamic";

interface RouteContext {
  readonly params: Promise<{ readonly projectId: string }>;
}

export function GET(request: NextRequest, context: RouteContext): Promise<Response> {
  return apiRoute(async () => {
    const actor = await authenticateRequest(request);
    const path = parsePath(await context.params, projectPathParamsSchema);
    const conversations = await getWebRuntime().conversations.list(path.projectId, actor.id);
    return jsonSuccess(conversationListResponseSchema, conversations);
  });
}

export function POST(request: NextRequest, context: RouteContext): Promise<Response> {
  return apiRoute(async () => {
    const actor = await authenticateRequest(request);
    const [path, body] = await Promise.all([
      context.params.then((params) => parsePath(params, projectPathParamsSchema)),
      parseBody(request, createConversationBodySchema),
    ]);
    const conversation = await getWebRuntime().conversations.create({
      projectId: path.projectId,
      actorUserId: actor.id,
      title: body.title,
    });
    return jsonSuccess(conversationResponseSchema, conversation, 201);
  });
}
