import { createHandlers } from "../../../../../../../../../../api/handlers/projects/[projectId]/merge-requests/[mergeRequestId]/conflicts/[conflictId]/resolution/route";
import { getWebRuntime } from "../../../../../../../../../server/runtime";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
const handlers = createHandlers(getWebRuntime);

interface RouteContext {
  readonly params: Promise<{
    readonly projectId: string;
    readonly mergeRequestId: string;
    readonly conflictId: string;
  }>;
}

export async function PUT(request: Request, context: RouteContext): Promise<Response> {
  return handlers.PUT(request, { params: await context.params });
}
