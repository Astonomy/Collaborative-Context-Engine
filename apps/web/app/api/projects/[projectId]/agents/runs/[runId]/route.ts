import { agentRunPathParamsSchema, agentRunResponseSchema } from "@cce/api-contracts";
import type { NextRequest } from "next/server";

import {
  apiRoute,
  authenticateRequest,
  jsonSuccess,
  parsePath,
} from "../../../../../../../server/request";
import { getWebRuntime } from "../../../../../../../server/runtime";

export const dynamic = "force-dynamic";

interface RouteContext {
  readonly params: Promise<{
    readonly projectId: string;
    readonly runId: string;
  }>;
}

export function GET(request: NextRequest, context: RouteContext): Promise<Response> {
  return apiRoute(async () => {
    const actor = await authenticateRequest(request);
    const path = parsePath(await context.params, agentRunPathParamsSchema);
    const result = await getWebRuntime().agents.get({ ...path, actorUserId: actor.id });
    return jsonSuccess(agentRunResponseSchema, result);
  });
}
