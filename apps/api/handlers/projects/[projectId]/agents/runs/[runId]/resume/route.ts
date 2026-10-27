import {
  agentRunPathParamsSchema,
  agentRunResponseSchema,
  resumeAgentRunBodySchema,
} from "@cce/api-contracts";

import {
  apiRoute,
  authenticateRequest,
  jsonSuccess,
  parseBody,
  parsePath,
} from "../../../../../../../server/request";
import type { HttpServices } from "../../../../../../../server/services";

interface RouteContext {
  readonly params: {
    readonly projectId: string;
    readonly runId: string;
  };
}

export function createHandlers(
  getRuntime: () => Pick<HttpServices, "agents" | "sessions" | "sessionCookie">,
): { POST: (request: Request, context: RouteContext) => Promise<Response> } {
  function POST(request: Request, context: RouteContext): Promise<Response> {
    return apiRoute(async () => {
      const actor = await authenticateRequest(request, getRuntime());
      const [path, body] = await Promise.all([
        Promise.resolve().then(() => parsePath(context.params, agentRunPathParamsSchema)),
        parseBody(request, resumeAgentRunBodySchema),
      ]);
      const result = await getRuntime().agents.resume({
        ...path,
        actorUserId: actor.id,
        decision: body.decision,
        rationale: body.rationale,
      });
      return jsonSuccess(agentRunResponseSchema, result);
    });
  }

  return { POST };
}
