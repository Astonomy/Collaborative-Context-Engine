import { projectPathParamsSchema } from "@cce/api-contracts";
import { contextCommitSchema } from "@cce/domain";
import type { NextRequest } from "next/server";
import { z } from "zod";

import {
  apiRoute,
  authenticateRequest,
  jsonSuccess,
  parsePath,
} from "../../../../../../server/request";
import { getWebRuntime } from "../../../../../../server/runtime";

export const dynamic = "force-dynamic";

const commitListResponseSchema = z.array(contextCommitSchema);

interface RouteContext {
  readonly params: Promise<{ readonly projectId: string }>;
}

export function GET(request: NextRequest, context: RouteContext): Promise<Response> {
  return apiRoute(async () => {
    const actor = await authenticateRequest(request);
    const path = parsePath(await context.params, projectPathParamsSchema);
    const commits = await getWebRuntime().contexts.listCommits({
      projectId: path.projectId,
      actorUserId: actor.id,
    });
    return jsonSuccess(commitListResponseSchema, commits);
  });
}
