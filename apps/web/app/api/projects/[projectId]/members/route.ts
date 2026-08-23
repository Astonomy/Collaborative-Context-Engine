import {
  addProjectMemberBodySchema,
  projectMemberListResponseSchema,
  projectMemberMutationResponseSchema,
  projectPathParamsSchema,
} from "@cce/api-contracts";
import type { NextRequest } from "next/server";

import {
  apiRoute,
  authenticateRequest,
  jsonSuccess,
  parseBody,
  parsePath,
} from "../../../../../server/request";
import { listProjectMembers } from "../../../../../server/queries";
import { getWebRuntime } from "../../../../../server/runtime";

export const dynamic = "force-dynamic";

interface RouteContext {
  readonly params: Promise<{ readonly projectId: string }>;
}

export function GET(request: NextRequest, context: RouteContext): Promise<Response> {
  return apiRoute(async () => {
    const actor = await authenticateRequest(request);
    const path = parsePath(await context.params, projectPathParamsSchema);
    const runtime = getWebRuntime();
    const members = await listProjectMembers(runtime.unitOfWork, path.projectId, actor.id);
    return jsonSuccess(projectMemberListResponseSchema, members);
  });
}

export function POST(request: NextRequest, context: RouteContext): Promise<Response> {
  return apiRoute(async () => {
    const actor = await authenticateRequest(request);
    const [path, body] = await Promise.all([
      context.params.then((params) => parsePath(params, projectPathParamsSchema)),
      parseBody(request, addProjectMemberBodySchema),
    ]);
    await getWebRuntime().projects.addMember({
      projectId: path.projectId,
      actorUserId: actor.id,
      memberEmail: body.email,
      role: body.role,
    });
    return jsonSuccess(projectMemberMutationResponseSchema, { success: true }, 201);
  });
}
