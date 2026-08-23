import {
  projectAuditHistoryResponseSchema,
  projectPathParamsSchema,
} from "@cce/api-contracts";
import type { NextRequest } from "next/server";

import {
  apiRoute,
  authenticateRequest,
  jsonSuccess,
  parsePath,
} from "../../../../../server/request";
import { getWebRuntime } from "../../../../../server/runtime";

export const dynamic = "force-dynamic";

interface RouteContext {
  readonly params: Promise<{ readonly projectId: string }>;
}

export function GET(request: NextRequest, context: RouteContext): Promise<Response> {
  return apiRoute(async () => {
    const actor = await authenticateRequest(request);
    const path = parsePath(await context.params, projectPathParamsSchema);
    const history = await getWebRuntime().audit.getProjectHistory({
      projectId: path.projectId,
      actorUserId: actor.id,
    });
    return jsonSuccess(projectAuditHistoryResponseSchema, history);
  });
}
