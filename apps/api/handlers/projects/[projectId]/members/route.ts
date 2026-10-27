import {
  addProjectMemberBodySchema,
  projectMemberListResponseSchema,
  projectMemberMutationResponseSchema,
  projectPathParamsSchema,
} from "@cce/api-contracts";

import {
  apiRoute,
  authenticateRequest,
  jsonSuccess,
  parseBody,
  parsePath,
} from "../../../../server/request";
import { listProjectMembers } from "@cce/application";
import type { HttpServices } from "../../../../server/services";

interface RouteContext {
  readonly params: { readonly projectId: string };
}

export function createHandlers(
  getRuntime: () => Pick<HttpServices, "unitOfWork" | "projects" | "sessions" | "sessionCookie">,
): {
  GET: (request: Request, context: RouteContext) => Promise<Response>;
  POST: (request: Request, context: RouteContext) => Promise<Response>;
} {
  function GET(request: Request, context: RouteContext): Promise<Response> {
    return apiRoute(async () => {
      const actor = await authenticateRequest(request, getRuntime());
      const path = parsePath(context.params, projectPathParamsSchema);
      const runtime = getRuntime();
      const members = await listProjectMembers(runtime.unitOfWork, path.projectId, actor.id);
      return jsonSuccess(projectMemberListResponseSchema, members);
    });
  }

  function POST(request: Request, context: RouteContext): Promise<Response> {
    return apiRoute(async () => {
      const actor = await authenticateRequest(request, getRuntime());
      const [path, body] = await Promise.all([
        Promise.resolve().then(() => parsePath(context.params, projectPathParamsSchema)),
        parseBody(request, addProjectMemberBodySchema),
      ]);
      await getRuntime().projects.addMember({
        projectId: path.projectId,
        actorUserId: actor.id,
        memberEmail: body.email,
        role: body.role,
      });
      return jsonSuccess(projectMemberMutationResponseSchema, { success: true }, 201);
    });
  }

  return { GET, POST };
}
