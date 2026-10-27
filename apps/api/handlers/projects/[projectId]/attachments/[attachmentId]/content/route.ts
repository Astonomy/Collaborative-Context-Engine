import { attachmentPathParamsSchema } from "@cce/api-contracts";
import { apiRoute, authenticateRequest, parsePath } from "../../../../../../server/request";
import type { HttpServices } from "../../../../../../server/services";
import {
  attachmentContentResponse,
  attachmentRangeError,
} from "../../../../../../server/attachment-content";

interface RouteContext {
  readonly params: { projectId: string; attachmentId: string };
}

export function createHandlers(
  getRuntime: () => Pick<HttpServices, "attachments" | "sessions" | "sessionCookie">,
): { GET: (request: Request, context: RouteContext) => Promise<Response> } {
  function GET(request: Request, context: RouteContext): Promise<Response> {
    return apiRoute(async (requestId) => {
      const actor = await authenticateRequest(request, getRuntime());
      const path = parsePath(context.params, attachmentPathParamsSchema);
      const range = request.headers.has("if-range") ? null : request.headers.get("range");
      try {
        return attachmentContentResponse(
          await getRuntime().attachments.download({
            ...path,
            actorUserId: actor.id,
            ...(range === null ? {} : { range }),
          }),
        );
      } catch (error) {
        return attachmentRangeError(error, requestId);
      }
    });
  }

  return { GET };
}
