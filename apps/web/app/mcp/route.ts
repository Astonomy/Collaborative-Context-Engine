import { createHandlers } from "../../../api/handlers/mcp/route";
import { getWebRuntime } from "../../server/runtime";
export const dynamic = "force-dynamic";
const handlers = createHandlers(getWebRuntime);
export const GET = handlers.GET;
export const POST = handlers.POST;
export const DELETE = handlers.DELETE;
