import {
  createMergeRequestBodySchema,
  mergeRequestDetailResponseSchema,
  mergeRequestListResponseSchema,
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
import { listMergeRequests } from "../../../../../server/queries";
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
    const merges = await listMergeRequests(runtime.unitOfWork, path.projectId, actor.id);
    return jsonSuccess(mergeRequestListResponseSchema, merges);
  });
}

export function POST(request: NextRequest, context: RouteContext): Promise<Response> {
  return apiRoute(async () => {
    const actor = await authenticateRequest(request);
    const [path, body] = await Promise.all([
      context.params.then((params) => parsePath(params, projectPathParamsSchema)),
      parseBody(request, createMergeRequestBodySchema),
    ]);
    const detail = await getWebRuntime().merges.create({
      projectId: path.projectId,
      deltaId: body.deltaId,
      actorUserId: actor.id,
    });
    return jsonSuccess(mergeRequestDetailResponseSchema, detail, 201);
  });
}
