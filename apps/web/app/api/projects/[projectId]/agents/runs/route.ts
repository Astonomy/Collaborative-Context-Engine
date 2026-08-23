import {
  agentRunResponseSchema,
  agentRunListResponseSchema,
  createAgentRunBodySchema,
  listAgentRunsQuerySchema,
  projectPathParamsSchema,
} from "@cce/api-contracts";
import type { NextRequest } from "next/server";

import {
  apiRoute,
  authenticateRequest,
  jsonSuccess,
  parseBody,
  parsePath,
  parseQuery,
} from "../../../../../../server/request";
import { getWebRuntime } from "../../../../../../server/runtime";

export const dynamic = "force-dynamic";

interface RouteContext {
  readonly params: Promise<{ readonly projectId: string }>;
}

export function GET(request: NextRequest, context: RouteContext): Promise<Response> {
  return apiRoute(async () => {
    const actor = await authenticateRequest(request);
    const path = parsePath(await context.params, projectPathParamsSchema);
    const query = parseQuery(request, listAgentRunsQuerySchema);
    const runs = await getWebRuntime().agents.list({
      projectId: path.projectId,
      actorUserId: actor.id,
      ...(query.status === undefined ? {} : { status: query.status }),
    });
    return jsonSuccess(agentRunListResponseSchema, runs);
  });
}

export function POST(request: NextRequest, context: RouteContext): Promise<Response> {
  return apiRoute(async () => {
    const actor = await authenticateRequest(request);
    const [path, body] = await Promise.all([
      context.params.then((params) => parsePath(params, projectPathParamsSchema)),
      parseBody(request, createAgentRunBodySchema),
    ]);
    const result = await getWebRuntime().agents.start({
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
