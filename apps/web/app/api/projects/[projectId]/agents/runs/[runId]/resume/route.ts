import {
  agentRunPathParamsSchema,
  agentRunResponseSchema,
  resumeAgentRunBodySchema,
} from "@cce/api-contracts";
import type { NextRequest } from "next/server";

import {
  apiRoute,
  authenticateRequest,
  jsonSuccess,
  parseBody,
  parsePath,
} from "../../../../../../../../server/request";
import { getWebRuntime } from "../../../../../../../../server/runtime";

export const dynamic = "force-dynamic";

interface RouteContext {
  readonly params: Promise<{
    readonly projectId: string;
    readonly runId: string;
  }>;
}

export function POST(request: NextRequest, context: RouteContext): Promise<Response> {
  return apiRoute(async () => {
    const actor = await authenticateRequest(request);
    const [path, body] = await Promise.all([
      context.params.then((params) => parsePath(params, agentRunPathParamsSchema)),
      parseBody(request, resumeAgentRunBodySchema),
    ]);
    const result = await getWebRuntime().agents.resume({
      ...path,
      actorUserId: actor.id,
      decision: body.decision,
      rationale: body.rationale,
    });
    return jsonSuccess(agentRunResponseSchema, result);
  });
}
