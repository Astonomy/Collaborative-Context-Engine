import {
  conversationPathParamsSchema,
  conversationResponseSchema,
  updateConversationBodySchema,
  toAttachmentResponse,
} from "@cce/api-contracts";

import {
  apiRoute,
  authenticateRequest,
  jsonSuccess,
  parseBody,
  parsePath,
} from "../../../../../server/request";
import type { HttpServices } from "../../../../../server/services";

interface RouteContext {
  readonly params: {
    readonly projectId: string;
    readonly conversationId: string;
  };
}

export function createHandlers(
  getRuntime: () => Pick<HttpServices, "conversations" | "sessions" | "sessionCookie"> & {
    attachments: Pick<HttpServices["attachments"], "list">;
  },
): {
  GET: (request: Request, context: RouteContext) => Promise<Response>;
  PATCH: (request: Request, context: RouteContext) => Promise<Response>;
} {
  function GET(request: Request, context: RouteContext): Promise<Response> {
    return apiRoute(async () => {
      const actor = await authenticateRequest(request, getRuntime());
      const path = parsePath(context.params, conversationPathParamsSchema);
      const conversation = await getRuntime().conversations.get({
        ...path,
        actorUserId: actor.id,
      });
      const attachments = await getRuntime().attachments.list({ ...path, actorUserId: actor.id });
      return jsonSuccess(conversationResponseSchema, {
        ...conversation,
        attachments: attachments.map(toAttachmentResponse),
      });
    });
  }

  function PATCH(request: Request, context: RouteContext): Promise<Response> {
    return apiRoute(async () => {
      const actor = await authenticateRequest(request, getRuntime());
      const [path, body] = await Promise.all([
        Promise.resolve().then(() => parsePath(context.params, conversationPathParamsSchema)),
        parseBody(request, updateConversationBodySchema),
      ]);
      const conversation = await getRuntime().conversations.update({
        ...path,
        actorUserId: actor.id,
        ...(body.title === undefined ? {} : { title: body.title }),
        ...(body.archive === undefined ? {} : { archive: body.archive }),
      });
      return jsonSuccess(conversationResponseSchema, conversation);
    });
  }

  return { GET, PATCH };
}
