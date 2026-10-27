import { createHandlers } from "../../../../api/handlers/health/route";
import { getWebRuntime } from "../../../server/runtime";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
const handlers = createHandlers(getWebRuntime);

export function GET(): Promise<Response> {
  return handlers.GET();
}
