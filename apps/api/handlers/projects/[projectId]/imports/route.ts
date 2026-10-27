import {
  confirmConversationImportBodySchema,
  conversationImportResponseSchema,
  projectPathParamsSchema,
} from "@cce/api-contracts";
import {
  apiRoute,
  authenticateRequest,
  jsonSuccess,
  parseBody,
  parsePath,
  TransportError,
} from "../../../../server/request";
import type { HttpServices } from "../../../../server/services";
interface Context {
  readonly params: { readonly projectId: string };
}
function decode(value: string): Uint8Array {
  const result = Buffer.from(value, "base64");
  if (result.length === 0) throw new TransportError("dataBase64 must be base64.");
  return result;
}
export function createHandlers(
  getRuntime: () => Pick<HttpServices, "conversationImports" | "sessions" | "sessionCookie">,
): { POST: (request: Request, context: Context) => Promise<Response> } {
  function POST(request: Request, context: Context): Promise<Response> {
    return apiRoute(async () => {
      const actor = await authenticateRequest(request, getRuntime());
      const [path, body] = await Promise.all([
        Promise.resolve().then(() => parsePath(context.params, projectPathParamsSchema)),
        parseBody(request, confirmConversationImportBodySchema),
      ]);
      return jsonSuccess(
        conversationImportResponseSchema,
        await getRuntime().conversationImports.confirm({
          projectId: path.projectId,
          actorUserId: actor.id,
          fileName: body.fileName,
          bytes: decode(body.dataBase64),
          selectedConversationIds: body.selectedConversationIds,
        }),
        201,
      );
    });
  }

  return { POST };
}
