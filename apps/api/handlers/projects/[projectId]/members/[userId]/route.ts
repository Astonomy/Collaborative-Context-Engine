import {
  changeProjectMemberRoleBodySchema,
  projectMemberMutationResponseSchema,
  projectMemberPathParamsSchema,
} from "@cce/api-contracts";

import {
  apiRoute,
  authenticateRequest,
  jsonSuccess,
  parseBody,
  parsePath,
} from "../../../../../server/request";
import type { HttpServices } from "../../../../../server/services";

interface RouteContext {
  readonly params: {
    readonly projectId: string;
    readonly userId: string;
  };
}

export function createHandlers(
  getRuntime: () => Pick<HttpServices, "projects" | "sessions" | "sessionCookie">,
): { PUT: (request: Request, context: RouteContext) => Promise<Response> } {
  function PUT(request: Request, context: RouteContext): Promise<Response> {
    return apiRoute(async () => {
      const actor = await authenticateRequest(request, getRuntime());
      const [path, body] = await Promise.all([
        Promise.resolve().then(() => parsePath(context.params, projectMemberPathParamsSchema)),
        parseBody(request, changeProjectMemberRoleBodySchema),
      ]);
      await getRuntime().projects.changeMemberRole({
        projectId: path.projectId,
        actorUserId: actor.id,
        targetUserId: path.userId,
        role: body.role,
      });
      return jsonSuccess(projectMemberMutationResponseSchema, { success: true });
    });
  }

  return { PUT };
}
