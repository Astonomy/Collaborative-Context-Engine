import {
  contextSnapshotResponseSchema,
  getContextQuerySchema,
  projectPathParamsSchema,
} from "@cce/api-contracts";

import {
  apiRoute,
  authenticateRequest,
  jsonSuccess,
  parsePath,
  parseQuery,
} from "../../../../server/request";
import type { HttpServices } from "../../../../server/services";

interface RouteContext {
  readonly params: { readonly projectId: string };
}

export function createHandlers(
  getRuntime: () => Pick<HttpServices, "contexts" | "sessions" | "sessionCookie">,
): { GET: (request: Request, context: RouteContext) => Promise<Response> } {
  function GET(request: Request, context: RouteContext): Promise<Response> {
    return apiRoute(async () => {
      const actor = await authenticateRequest(request, getRuntime());
      const path = parsePath(context.params, projectPathParamsSchema);
      const query = parseQuery(request, getContextQuerySchema);
      const runtime = getRuntime();
      const snapshot = await runtime.contexts.getHeadSnapshot({
        projectId: path.projectId,
        actorUserId: actor.id,
      });
      const items = snapshot.items.filter(
        (item) =>
          (query.kind === undefined || item.kind === query.kind) &&
          (query.lifecycle === undefined || item.lifecycle === query.lifecycle),
      );
      return jsonSuccess(contextSnapshotResponseSchema, {
        commitId: snapshot.commitId,
        items,
      });
    });
  }

  return { GET };
}
