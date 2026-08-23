import {
  finalizeMergeRequestBodySchema,
  finalizeMergeRequestHeadersSchema,
  finalizeMergeRequestResponseSchema,
  mergeRequestPathParamsSchema,
} from "@cce/api-contracts";
import type { NextRequest } from "next/server";

import {
  apiRoute,
  authenticateRequest,
  jsonSuccess,
  parseBody,
  parsePath,
} from "../../../../../../../server/request";
import { getWebRuntime } from "../../../../../../../server/runtime";

export const dynamic = "force-dynamic";

interface RouteContext {
  readonly params: Promise<{
    readonly projectId: string;
    readonly mergeRequestId: string;
  }>;
}

export function POST(request: NextRequest, context: RouteContext): Promise<Response> {
  return apiRoute(async () => {
    const actor = await authenticateRequest(request);
    const [path, body] = await Promise.all([
      context.params.then((params) => parsePath(params, mergeRequestPathParamsSchema)),
      parseBody(request, finalizeMergeRequestBodySchema),
    ]);
    const headers = finalizeMergeRequestHeadersSchema.parse({
      "idempotency-key": request.headers.get("idempotency-key"),
    });
    const result = await getWebRuntime().merges.finalize({
      ...path,
      actorUserId: actor.id,
      expectedHeadCommitId: body.expectedHeadCommitId,
      summary: body.summary,
      idempotencyKey: headers["idempotency-key"],
    });
    return jsonSuccess(finalizeMergeRequestResponseSchema, result);
  });
}
