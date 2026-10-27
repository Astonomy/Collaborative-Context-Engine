import {
  finalizeMergeRequestBodySchema,
  finalizeMergeRequestHeadersSchema,
  finalizeMergeRequestResponseSchema,
  mergeRequestPathParamsSchema,
} from "@cce/api-contracts";

import {
  apiRoute,
  authenticateRequest,
  jsonSuccess,
  parseBody,
  parsePath,
} from "../../../../../../server/request";
import type { HttpServices } from "../../../../../../server/services";

interface RouteContext {
  readonly params: {
    readonly projectId: string;
    readonly mergeRequestId: string;
  };
}

export function createHandlers(
  getRuntime: () => Pick<HttpServices, "merges" | "sessions" | "sessionCookie">,
): { POST: (request: Request, context: RouteContext) => Promise<Response> } {
  function POST(request: Request, context: RouteContext): Promise<Response> {
    return apiRoute(async () => {
      const actor = await authenticateRequest(request, getRuntime());
      const [path, body] = await Promise.all([
        Promise.resolve().then(() => parsePath(context.params, mergeRequestPathParamsSchema)),
        parseBody(request, finalizeMergeRequestBodySchema),
      ]);
      const headers = finalizeMergeRequestHeadersSchema.parse({
        "idempotency-key": request.headers.get("idempotency-key"),
      });
      const result = await getRuntime().merges.finalize({
        ...path,
        actorUserId: actor.id,
        expectedHeadCommitId: body.expectedHeadCommitId,
        summary: body.summary,
        idempotencyKey: headers["idempotency-key"],
      });
      return jsonSuccess(finalizeMergeRequestResponseSchema, result);
    });
  }

  return { POST };
}
