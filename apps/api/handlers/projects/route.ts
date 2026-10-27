import {
  createProjectBodySchema,
  projectListResponseSchema,
  projectResponseSchema,
} from "@cce/api-contracts";

import { apiRoute, authenticateRequest, jsonSuccess, parseBody } from "../../server/request";
import type { HttpServices } from "../../server/services";

export function createHandlers(
  getRuntime: () => Pick<HttpServices, "projects" | "sessions" | "sessionCookie">,
): { GET: (request: Request) => Promise<Response>; POST: (request: Request) => Promise<Response> } {
  function GET(request: Request): Promise<Response> {
    return apiRoute(async () => {
      const actor = await authenticateRequest(request, getRuntime());
      const projects = await getRuntime().projects.list(actor.id);
      return jsonSuccess(projectListResponseSchema, projects);
    });
  }

  function POST(request: Request): Promise<Response> {
    return apiRoute(async () => {
      const actor = await authenticateRequest(request, getRuntime());
      const body = await parseBody(request, createProjectBodySchema);
      const project = await getRuntime().projects.create({
        name: body.name,
        actorUserId: actor.id,
      });
      return jsonSuccess(projectResponseSchema, project, 201);
    });
  }

  return { GET, POST };
}
