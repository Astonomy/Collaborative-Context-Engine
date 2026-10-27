import {
  conversationImportResponseSchema,
  projectPathParamsSchema,
  providerConversationImportSubmitBodySchema,
} from "@cce/api-contracts";

import {
  apiRoute,
  authenticateRequest,
  jsonSuccess,
  parseBody,
  parsePath,
} from "../../../../../server/request";
import type { HttpServices } from "../../../../../server/services";

interface Context {
  readonly params: { readonly projectId: string };
}

export function createHandlers(
  getRuntime: () => Pick<HttpServices, "conversationImports" | "sessions" | "sessionCookie">,
): { POST: (request: Request, context: Context) => Promise<Response> } {
  function POST(request: Request, context: Context): Promise<Response> {
    return apiRoute(async () => {
      const actor = await authenticateRequest(request, getRuntime());
      const [path, body] = await Promise.all([
        Promise.resolve().then(() => parsePath(context.params, projectPathParamsSchema)),
        parseBody(request, providerConversationImportSubmitBodySchema),
      ]);
      return jsonSuccess(
        conversationImportResponseSchema,
        await getRuntime().conversationImports.submitProviderPreview({
          projectId: path.projectId,
          actorUserId: actor.id,
          previewId: body.previewId,
        }),
        201,
      );
    });
  }

  return { POST };
}
