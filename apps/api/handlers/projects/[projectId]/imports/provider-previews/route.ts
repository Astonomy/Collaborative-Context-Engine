import {
  projectPathParamsSchema,
  providerConversationImportPreviewBodySchema,
  providerConversationImportPreviewResponseSchema,
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
      const [path, submission] = await Promise.all([
        Promise.resolve().then(() => parsePath(context.params, projectPathParamsSchema)),
        parseBody(request, providerConversationImportPreviewBodySchema),
      ]);
      return jsonSuccess(
        providerConversationImportPreviewResponseSchema,
        await getRuntime().conversationImports.previewProviderSubmission({
          projectId: path.projectId,
          actorUserId: actor.id,
          submission,
        }),
        201,
      );
    });
  }

  return { POST };
}
