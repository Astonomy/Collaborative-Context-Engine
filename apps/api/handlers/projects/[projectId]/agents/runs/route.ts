import {
  agentRunResponseSchema,
  agentRunListResponseSchema,
  createAgentRunBodySchema,
  listAgentRunsQuerySchema,
  projectPathParamsSchema,
} from "@cce/api-contracts";

import {
  apiRoute,
  authenticateRequest,
  jsonSuccess,
  parseBody,
  parsePath,
  parseQuery,
} from "../../../../../server/request";
import type { HttpServices } from "../../../../../server/services";

interface RouteContext {
  readonly params: { readonly projectId: string };
}

export function createHandlers(
  getRuntime: () => Pick<HttpServices, "agents" | "sessions" | "sessionCookie">,
): {
  GET: (request: Request, context: RouteContext) => Promise<Response>;
  POST: (request: Request, context: RouteContext) => Promise<Response>;
} {
  function GET(request: Request, context: RouteContext): Promise<Response> {
    return apiRoute(async () => {
      const actor = await authenticateRequest(request, getRuntime());
      const path = parsePath(context.params, projectPathParamsSchema);
      const query = parseQuery(request, listAgentRunsQuerySchema);
      const runs = await getRuntime().agents.list({
        projectId: path.projectId,
        actorUserId: actor.id,
        ...(query.status === undefined ? {} : { status: query.status }),
      });
      return jsonSuccess(agentRunListResponseSchema, runs);
    });
  }

  function POST(request: Request, context: RouteContext): Promise<Response> {
    return apiRoute(async () => {
      const actor = await authenticateRequest(request, getRuntime());
      const [path, body] = await Promise.all([
        Promise.resolve().then(() => parsePath(context.params, projectPathParamsSchema)),
        parseBody(request, createAgentRunBodySchema),
      ]);
      const result = await getRuntime().agents.start({
        projectId: path.projectId,
        conversationId: body.conversationId,
        throughMessageSequence: body.throughMessageSequence,
        objective: body.objective,
        actorUserId: actor.id,
        signal: request.signal,
      });
      return jsonSuccess(agentRunResponseSchema, result, 201);
    });
  }

  return { GET, POST };
}
