import { createHandlers } from "../../../../../../../../api/handlers/projects/[projectId]/conversations/[conversationId]/attachments/route";
import { getWebRuntime } from "../../../../../../../server/runtime";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
const handlers = createHandlers(getWebRuntime);

interface RouteContext {
  readonly params: Promise<{ projectId: string; conversationId: string }>;
}

export async function POST(request: Request, context: RouteContext): Promise<Response> {
  return handlers.POST(request, { params: await context.params });
}
export async function GET(request: Request, context: RouteContext): Promise<Response> {
  return handlers.GET(request, { params: await context.params });
}
