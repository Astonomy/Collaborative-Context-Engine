import { mergeRequestDetailResponseSchema, mergeRequestPathParamsSchema } from "@cce/api-contracts";
import { ApplicationError } from "@cce/application";

import {
  apiRoute,
  authenticateRequest,
  jsonSuccess,
  parsePath,
} from "../../../../../server/request";
import { getMergeRequestDetail } from "@cce/application";
import type { HttpServices } from "../../../../../server/services";

interface RouteContext {
  readonly params: {
    readonly projectId: string;
    readonly mergeRequestId: string;
  };
}

export function createHandlers(
  getRuntime: () => Pick<HttpServices, "unitOfWork" | "sessions" | "sessionCookie">,
): { GET: (request: Request, context: RouteContext) => Promise<Response> } {
  function GET(request: Request, context: RouteContext): Promise<Response> {
    return apiRoute(async () => {
      const actor = await authenticateRequest(request, getRuntime());
      const path = parsePath(context.params, mergeRequestPathParamsSchema);
      const runtime = getRuntime();
      const detail = await getMergeRequestDetail(
        runtime.unitOfWork,
        path.projectId,
        path.mergeRequestId,
        actor.id,
      );
      if (detail === null) {
        throw new ApplicationError("NOT_FOUND", "MergeRequest was not found.");
      }
      return jsonSuccess(mergeRequestDetailResponseSchema, detail);
    });
  }

  return { GET };
}
