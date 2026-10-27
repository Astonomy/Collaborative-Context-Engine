import { toAttachmentResponse } from "@cce/api-contracts";
import {
  appendMessageBodySchema,
  conversationPathParamsSchema,
  messageListResponseSchema,
  messageResponseSchema,
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
  getRuntime: () => Pick<HttpServices, "conversations" | "sessions" | "sessionCookie"> & {
    attachments: Pick<HttpServices["attachments"], "list">;
  },
): {
  GET: (request: Request, context: RouteContext) => Promise<Response>;
  POST: (request: Request, context: RouteContext) => Promise<Response>;
} {
  function GET(request: Request, context: RouteContext): Promise<Response> {
    return apiRoute(async () => {
      const actor = await authenticateRequest(request, getRuntime());
      const path = parsePath(context.params, conversationPathParamsSchema);
      const messages = await getRuntime().conversations.listMessages({
        ...path,
        actorUserId: actor.id,
      });
      const attachments = await getRuntime().attachments.list({ ...path, actorUserId: actor.id });
      return jsonSuccess(
        messageListResponseSchema,
        messages.map((message) => ({
          ...message,
          attachments: attachments
            .filter((attachment) => attachment.messageId === message.id)
            .map(toAttachmentResponse),
        })),
      );
    });
  }

  function POST(request: Request, context: RouteContext): Promise<Response> {
    return apiRoute(async () => {
      const actor = await authenticateRequest(request, getRuntime());
      const [path, body] = await Promise.all([
        Promise.resolve().then(() => parsePath(context.params, conversationPathParamsSchema)),
        parseBody(request, appendMessageBodySchema),
      ]);
      const message = await getRuntime().conversations.appendUserMessage({
        ...path,
        actorUserId: actor.id,
        ...body,
      });
      return jsonSuccess(messageResponseSchema, message, 201);
    });
  }

  return { GET, POST };
}
