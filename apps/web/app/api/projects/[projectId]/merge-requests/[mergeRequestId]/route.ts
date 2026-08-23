import { mergeRequestDetailResponseSchema, mergeRequestPathParamsSchema } from "@cce/api-contracts";
import { ApplicationError } from "@cce/application";
import type { NextRequest } from "next/server";

import {
  apiRoute,
  authenticateRequest,
  jsonSuccess,
  parsePath,
} from "../../../../../../server/request";
import { getMergeRequestDetail } from "../../../../../../server/queries";
import { getWebRuntime } from "../../../../../../server/runtime";

export const dynamic = "force-dynamic";

interface RouteContext {
  readonly params: Promise<{
    readonly projectId: string;
    readonly mergeRequestId: string;
  }>;
}

export function GET(request: NextRequest, context: RouteContext): Promise<Response> {
  return apiRoute(async () => {
    const actor = await authenticateRequest(request);
    const path = parsePath(await context.params, mergeRequestPathParamsSchema);
    const runtime = getWebRuntime();
    const detail = await getMergeRequestDetail(
      runtime.unitOfWork,
      path.projectId,
      path.mergeRequestId,
      actor.id,
    );
    if (detail === null) {
      throw new ApplicationError("NOT_FOUND", "MergeRequest was not found.");
    }
    return jsonSuccess(mergeRequestDetailResponseSchema, detail);
  });
}
