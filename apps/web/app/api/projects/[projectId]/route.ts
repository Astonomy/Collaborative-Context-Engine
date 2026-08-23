import {
  projectAccessResponseSchema,
  projectPathParamsSchema,
  projectResponseSchema,
  updateProjectBodySchema,
} from "@cce/api-contracts";
import type { NextRequest } from "next/server";

import {
  apiRoute,
  authenticateRequest,
  jsonSuccess,
  parseBody,
  parsePath,
} from "../../../../server/request";
import { getWebRuntime } from "../../../../server/runtime";

export const dynamic = "force-dynamic";

interface RouteContext {
  readonly params: Promise<{ readonly projectId: string }>;
}

export function GET(request: NextRequest, context: RouteContext): Promise<Response> {
  return apiRoute(async () => {
    const actor = await authenticateRequest(request);
    const path = parsePath(await context.params, projectPathParamsSchema);
    const access = await getWebRuntime().projects.get(path.projectId, actor.id);
    return jsonSuccess(projectAccessResponseSchema, access);
  });
}

export function PATCH(request: NextRequest, context: RouteContext): Promise<Response> {
  return apiRoute(async () => {
    const actor = await authenticateRequest(request);
    const [path, body] = await Promise.all([
      context.params.then((params) => parsePath(params, projectPathParamsSchema)),
      parseBody(request, updateProjectBodySchema),
    ]);
    const project = await getWebRuntime().projects.update({
      projectId: path.projectId,
      actorUserId: actor.id,
      ...(body.name === undefined ? {} : { name: body.name }),
      ...(body.archive === undefined ? {} : { archive: body.archive }),
    });
    return jsonSuccess(projectResponseSchema, project);
  });
}
