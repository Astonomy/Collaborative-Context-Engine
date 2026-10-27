import {
  attachmentResponseSchema,
  attachmentListResponseSchema,
  conversationPathParamsSchema,
  toAttachmentResponse,
} from "@cce/api-contracts";
import {
  apiRoute,
  authenticateRequest,
  jsonSuccess,
  parsePath,
  TransportError,
} from "../../../../../../server/request";
import type { HttpServices } from "../../../../../../server/services";
import { attachmentRequestBytes } from "../../../../../../server/attachment-content";

interface RouteContext {
  readonly params: { projectId: string; conversationId: string };
}

export function createHandlers(
  getRuntime: () => Pick<HttpServices, "attachments" | "sessions" | "sessionCookie">,
): {
  POST: (request: Request, context: RouteContext) => Promise<Response>;
  GET: (request: Request, context: RouteContext) => Promise<Response>;
} {
  function GET(request: Request, context: RouteContext): Promise<Response> {
    return apiRoute(async () => {
      const actor = await authenticateRequest(request, getRuntime());
      const path = parsePath(context.params, conversationPathParamsSchema);
      const attachments = await getRuntime().attachments.list({ ...path, actorUserId: actor.id });
      return jsonSuccess(attachmentListResponseSchema, attachments.map(toAttachmentResponse));
    });
  }
  function POST(request: Request, context: RouteContext): Promise<Response> {
    return apiRoute(async () => {
      const actor = await authenticateRequest(request, getRuntime());
      const path = parsePath(context.params, conversationPathParamsSchema);
      let filename: string;
      try {
        filename = decodeURIComponent(request.headers.get("x-cce-filename") ?? "");
      } catch {
        throw new TransportError("Invalid encoded filename.");
      }
      const attachment = await getRuntime().attachments.upload(
        {
          ...path,
          actorUserId: actor.id,
          filename,
          clientMessageId: request.headers.get("x-cce-client-message-id") ?? "",
          declaredMimeType: request.headers.get("content-type") ?? "application/octet-stream",
        },
        attachmentRequestBytes(request),
      );
      return jsonSuccess(attachmentResponseSchema, toAttachmentResponse(attachment), 201);
    });
  }

  return { POST, GET };
}
