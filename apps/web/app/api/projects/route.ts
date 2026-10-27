import { createHandlers } from "../../../../api/handlers/projects/route";
import { getWebRuntime } from "../../../server/runtime";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
const handlers = createHandlers(getWebRuntime);

export function GET(request: Request): Promise<Response> {
  return handlers.GET(request);
}

export function POST(request: Request): Promise<Response> {
  return handlers.POST(request);
}
