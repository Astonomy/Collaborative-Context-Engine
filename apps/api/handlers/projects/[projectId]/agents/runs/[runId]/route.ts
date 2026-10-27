import { agentRunPathParamsSchema, agentRunResponseSchema } from "@cce/api-contracts";

import {
  apiRoute,
  authenticateRequest,
  jsonSuccess,
  parsePath,
} from "../../../../../../server/request";
import type { HttpServices } from "../../../../../../server/services";

interface RouteContext {
  readonly params: {
    readonly projectId: string;
    readonly runId: string;
  };
}

export function createHandlers(
  getRuntime: () => Pick<HttpServices, "agents" | "sessions" | "sessionCookie">,
): { GET: (request: Request, context: RouteContext) => Promise<Response> } {
  function GET(request: Request, context: RouteContext): Promise<Response> {
    return apiRoute(async () => {
      const actor = await authenticateRequest(request, getRuntime());
      const path = parsePath(context.params, agentRunPathParamsSchema);
      const result = await getRuntime().agents.get({ ...path, actorUserId: actor.id });
      return jsonSuccess(agentRunResponseSchema, result);
    });
  }

  return { GET };
}
