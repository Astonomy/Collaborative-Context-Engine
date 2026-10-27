import { createHandlers } from "../../../../../../../api/handlers/projects/[projectId]/imports/[importId]/route";
import { getWebRuntime } from "../../../../../../server/runtime";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
const handlers = createHandlers(getWebRuntime);

interface Context {
  readonly params: Promise<{ readonly projectId: string; readonly importId: string }>;
}

export async function GET(request: Request, context: Context): Promise<Response> {
  return handlers.GET(request, { params: await context.params });
}
