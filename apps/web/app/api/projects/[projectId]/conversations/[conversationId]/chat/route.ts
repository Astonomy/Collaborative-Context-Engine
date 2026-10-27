import { createHandlers } from "../../../../../../../../api/handlers/projects/[projectId]/conversations/[conversationId]/chat/route";
import { getWebRuntime } from "../../../../../../../server/runtime";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
const handlers = createHandlers(getWebRuntime);

interface RouteContext {
  readonly params: Promise<{
    readonly projectId: string;
    readonly conversationId: string;
  }>;
}

export async function POST(request: Request, context: RouteContext): Promise<Response> {
  return handlers.POST(request, { params: await context.params });
}
