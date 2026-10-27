import {
  projectAccessResponseSchema,
  projectPathParamsSchema,
  projectResponseSchema,
  updateProjectBodySchema,
} from "@cce/api-contracts";

import {
  apiRoute,
  authenticateRequest,
  jsonSuccess,
  parseBody,
  parsePath,
} from "../../../server/request";
import type { HttpServices } from "../../../server/services";

interface RouteContext {
  readonly params: { readonly projectId: string };
}

export function createHandlers(
  getRuntime: () => Pick<HttpServices, "projects" | "sessions" | "sessionCookie">,
): {
  GET: (request: Request, context: RouteContext) => Promise<Response>;
  PATCH: (request: Request, context: RouteContext) => Promise<Response>;
} {
  function GET(request: Request, context: RouteContext): Promise<Response> {
    return apiRoute(async () => {
      const actor = await authenticateRequest(request, getRuntime());
      const path = parsePath(context.params, projectPathParamsSchema);
      const access = await getRuntime().projects.get(path.projectId, actor.id);
      return jsonSuccess(projectAccessResponseSchema, access);
    });
  }

  function PATCH(request: Request, context: RouteContext): Promise<Response> {
    return apiRoute(async () => {
      const actor = await authenticateRequest(request, getRuntime());
      const [path, body] = await Promise.all([
        Promise.resolve().then(() => parsePath(context.params, projectPathParamsSchema)),
        parseBody(request, updateProjectBodySchema),
      ]);
      const project = await getRuntime().projects.update({
        projectId: path.projectId,
        actorUserId: actor.id,
        ...(body.name === undefined ? {} : { name: body.name }),
        ...(body.archive === undefined ? {} : { archive: body.archive }),
      });
      return jsonSuccess(projectResponseSchema, project);
    });
  }

  return { GET, PATCH };
}
