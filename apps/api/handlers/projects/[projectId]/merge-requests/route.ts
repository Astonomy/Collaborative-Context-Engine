import {
  createMergeRequestBodySchema,
  mergeRequestDetailResponseSchema,
  mergeRequestListResponseSchema,
  projectPathParamsSchema,
} from "@cce/api-contracts";

import {
  apiRoute,
  authenticateRequest,
  jsonSuccess,
  parseBody,
  parsePath,
} from "../../../../server/request";
import { listMergeRequests } from "@cce/application";
import type { HttpServices } from "../../../../server/services";

interface RouteContext {
  readonly params: { readonly projectId: string };
}

export function createHandlers(
  getRuntime: () => Pick<HttpServices, "unitOfWork" | "merges" | "sessions" | "sessionCookie">,
): {
  GET: (request: Request, context: RouteContext) => Promise<Response>;
  POST: (request: Request, context: RouteContext) => Promise<Response>;
} {
  function GET(request: Request, context: RouteContext): Promise<Response> {
    return apiRoute(async () => {
      const actor = await authenticateRequest(request, getRuntime());
      const path = parsePath(context.params, projectPathParamsSchema);
      const runtime = getRuntime();
      const merges = await listMergeRequests(runtime.unitOfWork, path.projectId, actor.id);
      return jsonSuccess(mergeRequestListResponseSchema, merges);
    });
  }

  function POST(request: Request, context: RouteContext): Promise<Response> {
    return apiRoute(async () => {
      const actor = await authenticateRequest(request, getRuntime());
      const [path, body] = await Promise.all([
        Promise.resolve().then(() => parsePath(context.params, projectPathParamsSchema)),
        parseBody(request, createMergeRequestBodySchema),
      ]);
      const detail = await getRuntime().merges.create({
        projectId: path.projectId,
        deltaId: body.deltaId,
        actorUserId: actor.id,
      });
      return jsonSuccess(mergeRequestDetailResponseSchema, detail, 201);
    });
  }

  return { GET, POST };
}
