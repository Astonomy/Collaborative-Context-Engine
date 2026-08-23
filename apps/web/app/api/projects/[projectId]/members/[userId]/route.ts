import {
  changeProjectMemberRoleBodySchema,
  projectMemberMutationResponseSchema,
  projectMemberPathParamsSchema,
} from "@cce/api-contracts";
import type { NextRequest } from "next/server";

import {
  apiRoute,
  authenticateRequest,
  jsonSuccess,
  parseBody,
  parsePath,
} from "../../../../../../server/request";
import { getWebRuntime } from "../../../../../../server/runtime";

export const dynamic = "force-dynamic";

interface RouteContext {
  readonly params: Promise<{
    readonly projectId: string;
    readonly userId: string;
  }>;
}

export function PUT(request: NextRequest, context: RouteContext): Promise<Response> {
  return apiRoute(async () => {
    const actor = await authenticateRequest(request);
    const [path, body] = await Promise.all([
      context.params.then((params) => parsePath(params, projectMemberPathParamsSchema)),
      parseBody(request, changeProjectMemberRoleBodySchema),
    ]);
    await getWebRuntime().projects.changeMemberRole({
      projectId: path.projectId,
      actorUserId: actor.id,
      targetUserId: path.userId,
      role: body.role,
    });
    return jsonSuccess(projectMemberMutationResponseSchema, { success: true });
  });
}
