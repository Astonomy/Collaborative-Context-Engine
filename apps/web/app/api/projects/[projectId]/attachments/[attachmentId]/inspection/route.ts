import { createHandlers } from "../../../../../../../../api/handlers/projects/[projectId]/attachments/[attachmentId]/inspection/route";
import { getWebRuntime } from "../../../../../../../server/runtime";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
const handlers = createHandlers(getWebRuntime);

export async function GET(
  request: Request,
  context: { params: Promise<{ projectId: string; attachmentId: string }> },
): Promise<Response> {
  return handlers.GET(request, { params: await context.params });
}
