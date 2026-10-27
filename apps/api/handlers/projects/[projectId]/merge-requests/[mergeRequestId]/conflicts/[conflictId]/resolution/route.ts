import {
  mergeConflictPathParamsSchema,
  resolveMergeConflictBodySchema,
  resolveMergeConflictResponseSchema,
} from "@cce/api-contracts";

import {
  apiRoute,
  authenticateRequest,
  jsonSuccess,
  parseBody,
  parsePath,
} from "../../../../../../../../server/request";
import type { HttpServices } from "../../../../../../../../server/services";

interface RouteContext {
  readonly params: {
    readonly projectId: string;
    readonly mergeRequestId: string;
    readonly conflictId: string;
  };
}

export function createHandlers(
  getRuntime: () => Pick<HttpServices, "merges" | "sessions" | "sessionCookie">,
): { PUT: (request: Request, context: RouteContext) => Promise<Response> } {
  function PUT(request: Request, context: RouteContext): Promise<Response> {
    return apiRoute(async () => {
      const actor = await authenticateRequest(request, getRuntime());
      const [path, body] = await Promise.all([
        Promise.resolve().then(() => parsePath(context.params, mergeConflictPathParamsSchema)),
        parseBody(request, resolveMergeConflictBodySchema),
      ]);
      const mergeRequest = await getRuntime().merges.resolve({
        ...path,
        actorUserId: actor.id,
        choice: body.choice,
        editedProposal: body.editedProposal,
        rationale: body.rationale,
      });
      return jsonSuccess(resolveMergeConflictResponseSchema, mergeRequest);
    });
  }

  return { PUT };
}
