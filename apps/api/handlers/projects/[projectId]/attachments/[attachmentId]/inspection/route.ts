import { attachmentPathParamsSchema } from "@cce/api-contracts";
import { mediaInspectionSchema } from "@cce/application/media-inspection";
import {
  apiRoute,
  authenticateRequest,
  jsonSuccess,
  parsePath,
} from "../../../../../../server/request";
import type { HttpServices } from "../../../../../../server/services";

export function createHandlers(
  getRuntime: () => Pick<HttpServices, "media" | "sessions" | "sessionCookie">,
): {
  GET: (
    request: Request,
    context: { params: { projectId: string; attachmentId: string } },
  ) => Promise<Response>;
} {
  function GET(
    request: Request,
    context: {
      readonly params: { projectId: string; attachmentId: string };
    },
  ): Promise<Response> {
    return apiRoute(async () => {
      const actor = await authenticateRequest(request, getRuntime());
      const path = parsePath(context.params, attachmentPathParamsSchema);
      return jsonSuccess(
        mediaInspectionSchema,
        await getRuntime().media.inspect({ ...path, actorUserId: actor.id }),
      );
    });
  }

  return { GET };
}
