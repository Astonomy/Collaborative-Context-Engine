import { createHandlers } from "../../../../../../../api/handlers/projects/[projectId]/merge-requests/[mergeRequestId]/route";
import { getWebRuntime } from "../../../../../../server/runtime";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
const handlers = createHandlers(getWebRuntime);

interface RouteContext {
  readonly params: Promise<{
    readonly projectId: string;
    readonly mergeRequestId: string;
  }>;
}

export async function GET(request: Request, context: RouteContext): Promise<Response> {
  return handlers.GET(request, { params: await context.params });
}
