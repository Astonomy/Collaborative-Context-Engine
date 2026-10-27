import { handleCceMcpRequest } from "@cce/mcp-server";
import { apiRoute, authenticateRequest, readBoundedRequestJson } from "../../server/request";
import type { HttpServices } from "../../server/services";
type McpHandler = (request: Request) => Promise<Response>;
export function createHandlers(getRuntime: () => HttpServices): {
  GET: McpHandler;
  POST: McpHandler;
  DELETE: McpHandler;
} {
  async function handle(request: Request): Promise<Response> {
    return apiRoute(async () => {
      const runtime = getRuntime();
      const actor = await authenticateRequest(request, runtime);
      const parsedBody =
        request.method === "POST" ? await readBoundedRequestJson(request) : undefined;
      return handleCceMcpRequest(
        request,
        {
          actorUserId: actor.id,
          projects: runtime.projects,
          conversationImports: runtime.conversationImports,
        },
        parsedBody,
      );
    });
  }
  return { GET: handle, POST: handle, DELETE: handle };
}
