import { createHandlers } from "../../../../../../../api/handlers/projects/[projectId]/context/items/route";
import { getWebRuntime } from "../../../../../../server/runtime";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
const handlers = createHandlers(getWebRuntime);

interface RouteContext {
  readonly params: Promise<{ readonly projectId: string }>;
}

export async function GET(request: Request, context: RouteContext): Promise<Response> {
  return handlers.GET(request, { params: await context.params });
}
