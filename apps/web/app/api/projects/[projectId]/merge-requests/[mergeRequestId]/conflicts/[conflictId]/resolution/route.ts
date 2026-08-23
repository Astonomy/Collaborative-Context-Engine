import {
  mergeConflictPathParamsSchema,
  resolveMergeConflictBodySchema,
  resolveMergeConflictResponseSchema,
} from "@cce/api-contracts";
import type { NextRequest } from "next/server";

import {
  apiRoute,
  authenticateRequest,
  jsonSuccess,
  parseBody,
  parsePath,
} from "../../../../../../../../../server/request";
import { getWebRuntime } from "../../../../../../../../../server/runtime";

export const dynamic = "force-dynamic";

interface RouteContext {
  readonly params: Promise<{
    readonly projectId: string;
    readonly mergeRequestId: string;
    readonly conflictId: string;
  }>;
}

export function PUT(request: NextRequest, context: RouteContext): Promise<Response> {
  return apiRoute(async () => {
    const actor = await authenticateRequest(request);
    const [path, body] = await Promise.all([
      context.params.then((params) => parsePath(params, mergeConflictPathParamsSchema)),
      parseBody(request, resolveMergeConflictBodySchema),
    ]);
    const mergeRequest = await getWebRuntime().merges.resolve({
      ...path,
      actorUserId: actor.id,
      choice: body.choice,
      editedProposal: body.editedProposal,
      rationale: body.rationale,
    });
    return jsonSuccess(resolveMergeConflictResponseSchema, mergeRequest);
  });
}
