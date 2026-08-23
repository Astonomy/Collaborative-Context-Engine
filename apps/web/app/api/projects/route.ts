import {
  createProjectBodySchema,
  projectListResponseSchema,
  projectResponseSchema,
} from "@cce/api-contracts";
import type { NextRequest } from "next/server";

import { apiRoute, authenticateRequest, jsonSuccess, parseBody } from "../../../server/request";
import { getWebRuntime } from "../../../server/runtime";

export const dynamic = "force-dynamic";

export function GET(request: NextRequest): Promise<Response> {
  return apiRoute(async () => {
    const actor = await authenticateRequest(request);
    const projects = await getWebRuntime().projects.list(actor.id);
    return jsonSuccess(projectListResponseSchema, projects);
  });
}

export function POST(request: NextRequest): Promise<Response> {
  return apiRoute(async () => {
    const actor = await authenticateRequest(request);
    const body = await parseBody(request, createProjectBodySchema);
    const project = await getWebRuntime().projects.create({
      name: body.name,
      actorUserId: actor.id,
    });
    return jsonSuccess(projectResponseSchema, project, 201);
  });
}
