import {
  agentRunPathParamsSchema,
  agentRunResponseSchema,
  reconcileAgentRunBodySchema,
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
    const [path] = await Promise.all([
      context.params.then((params) => parsePath(params, agentRunPathParamsSchema)),
      parseBody(request, reconcileAgentRunBodySchema),
    ]);
    const result = await getWebRuntime().agents.reconcile({
      ...path,
      actorUserId: actor.id,
    });
    return jsonSuccess(agentRunResponseSchema, result);
  });
}
