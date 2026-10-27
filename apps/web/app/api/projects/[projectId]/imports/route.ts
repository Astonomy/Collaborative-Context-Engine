import { createHandlers } from "../../../../../../api/handlers/projects/[projectId]/imports/route";
import { getWebRuntime } from "../../../../../server/runtime";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
const handlers = createHandlers(getWebRuntime);

interface Context {
  readonly params: Promise<{ readonly projectId: string }>;
}

export async function POST(request: Request, context: Context): Promise<Response> {
  return handlers.POST(request, { params: await context.params });
}
