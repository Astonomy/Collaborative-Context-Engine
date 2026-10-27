import { projectAuditHistoryResponseSchema, projectPathParamsSchema } from "@cce/api-contracts";

import { apiRoute, authenticateRequest, jsonSuccess, parsePath } from "../../../../server/request";
import type { HttpServices } from "../../../../server/services";

interface RouteContext {
  readonly params: { readonly projectId: string };
}

export function createHandlers(
  getRuntime: () => Pick<HttpServices, "audit" | "sessions" | "sessionCookie">,
): { GET: (request: Request, context: RouteContext) => Promise<Response> } {
  function GET(request: Request, context: RouteContext): Promise<Response> {
    return apiRoute(async () => {
      const actor = await authenticateRequest(request, getRuntime());
      const path = parsePath(context.params, projectPathParamsSchema);
      const history = await getRuntime().audit.getProjectHistory({
        projectId: path.projectId,
        actorUserId: actor.id,
      });
      return jsonSuccess(projectAuditHistoryResponseSchema, history);
    });
  }

  return { GET };
}
