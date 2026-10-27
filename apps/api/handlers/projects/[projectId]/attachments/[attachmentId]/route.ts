import {
  attachmentPathParamsSchema,
  attachmentResponseSchema,
  toAttachmentResponse,
} from "@cce/api-contracts";
import {
  apiRoute,
  authenticateRequest,
  jsonSuccess,
  parsePath,
} from "../../../../../server/request";
import type { HttpServices } from "../../../../../server/services";

interface RouteContext {
  readonly params: { projectId: string; attachmentId: string };
}
export function createHandlers(
  getRuntime: () => Pick<HttpServices, "attachments" | "sessions" | "sessionCookie">,
): { GET: (request: Request, context: RouteContext) => Promise<Response> } {
  function GET(request: Request, context: RouteContext): Promise<Response> {
    return apiRoute(async () => {
      const actor = await authenticateRequest(request, getRuntime());
      const path = parsePath(context.params, attachmentPathParamsSchema);
      return jsonSuccess(
        attachmentResponseSchema,
        toAttachmentResponse(
          await getRuntime().attachments.get({ ...path, actorUserId: actor.id }),
        ),
      );
    });
  }

  return { GET };
}
