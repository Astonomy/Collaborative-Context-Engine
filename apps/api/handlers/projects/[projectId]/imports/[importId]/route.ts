import { conversationImportPathSchema, conversationImportResponseSchema } from "@cce/api-contracts";
import {
  apiRoute,
  authenticateRequest,
  jsonSuccess,
  parsePath,
} from "../../../../../server/request";
import type { HttpServices } from "../../../../../server/services";
interface Context {
  readonly params: { readonly projectId: string; readonly importId: string };
}
export function createHandlers(
  getRuntime: () => Pick<HttpServices, "conversationImports" | "sessions" | "sessionCookie">,
): { GET: (request: Request, context: Context) => Promise<Response> } {
  function GET(request: Request, context: Context): Promise<Response> {
    return apiRoute(async () => {
      const actor = await authenticateRequest(request, getRuntime());
      const path = parsePath(context.params, conversationImportPathSchema);
      return jsonSuccess(
        conversationImportResponseSchema,
        await getRuntime().conversationImports.get(path.projectId, actor.id, path.importId),
      );
    });
  }

  return { GET };
}
