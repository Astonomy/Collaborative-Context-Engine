import { createHandlers } from "../../../../../../../api/handlers/projects/[projectId]/attachments/[attachmentId]/route";
import { getWebRuntime } from "../../../../../../server/runtime";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
const handlers = createHandlers(getWebRuntime);

interface RouteContext {
  readonly params: Promise<{ projectId: string; attachmentId: string }>;
}

export async function GET(request: Request, context: RouteContext): Promise<Response> {
  return handlers.GET(request, { params: await context.params });
}
