import {
  conversationListResponseSchema,
  conversationResponseSchema,
  createConversationBodySchema,
  projectPathParamsSchema,
} from "@cce/api-contracts";

import {
  apiRoute,
  authenticateRequest,
  jsonSuccess,
  parseBody,
  parsePath,
} from "../../../../server/request";
import type { HttpServices } from "../../../../server/services";

interface RouteContext {
  readonly params: { readonly projectId: string };
}

export function createHandlers(
  getRuntime: () => Pick<HttpServices, "conversations" | "sessions" | "sessionCookie">,
): {
  GET: (request: Request, context: RouteContext) => Promise<Response>;
  POST: (request: Request, context: RouteContext) => Promise<Response>;
} {
  function GET(request: Request, context: RouteContext): Promise<Response> {
    return apiRoute(async () => {
      const actor = await authenticateRequest(request, getRuntime());
      const path = parsePath(context.params, projectPathParamsSchema);
      const conversations = await getRuntime().conversations.list(path.projectId, actor.id);
      return jsonSuccess(conversationListResponseSchema, conversations);
    });
  }

  function POST(request: Request, context: RouteContext): Promise<Response> {
    return apiRoute(async () => {
      const actor = await authenticateRequest(request, getRuntime());
      const [path, body] = await Promise.all([
        Promise.resolve().then(() => parsePath(context.params, projectPathParamsSchema)),
        parseBody(request, createConversationBodySchema),
      ]);
      const conversation = await getRuntime().conversations.create({
        projectId: path.projectId,
        actorUserId: actor.id,
        title: body.title,
      });
      return jsonSuccess(conversationResponseSchema, conversation, 201);
    });
  }

  return { GET, POST };
}
