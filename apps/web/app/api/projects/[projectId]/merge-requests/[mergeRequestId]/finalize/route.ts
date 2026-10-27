import { createHandlers } from "../../../../../../../../api/handlers/projects/[projectId]/merge-requests/[mergeRequestId]/finalize/route";
import { getWebRuntime } from "../../../../../../../server/runtime";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
const handlers = createHandlers(getWebRuntime);

interface RouteContext {
  readonly params: Promise<{
    readonly projectId: string;
    readonly mergeRequestId: string;
  }>;
}

export async function POST(request: Request, context: RouteContext): Promise<Response> {
  return handlers.POST(request, { params: await context.params });
}
