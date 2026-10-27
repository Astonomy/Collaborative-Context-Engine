import { projectPathParamsSchema } from "@cce/api-contracts";
import { contextCommitSchema } from "@cce/domain";
import { z } from "zod";

import {
  apiRoute,
  authenticateRequest,
  jsonSuccess,
  parsePath,
} from "../../../../../server/request";
import type { HttpServices } from "../../../../../server/services";

const commitListResponseSchema = z.array(contextCommitSchema);

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
      const commits = await getRuntime().contexts.listCommits({
        projectId: path.projectId,
        actorUserId: actor.id,
      });
      return jsonSuccess(commitListResponseSchema, commits);
    });
  }

  return { GET };
}
