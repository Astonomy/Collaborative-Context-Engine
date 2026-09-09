import {
  projectPathParamsSchema,
  providerConversationImportPreviewBodySchema,
  providerConversationImportPreviewResponseSchema,
} from "@cce/api-contracts";
import type { NextRequest } from "next/server";

import {
  apiRoute,
  authenticateRequest,
  jsonSuccess,
  parseBody,
  parsePath,
} from "../../../../../../server/request";
import { getWebRuntime } from "../../../../../../server/runtime";

export const dynamic = "force-dynamic";

interface Context {
  readonly params: Promise<{ readonly projectId: string }>;
}

export function POST(request: NextRequest, context: Context): Promise<Response> {
  return apiRoute(async () => {
    const actor = await authenticateRequest(request);
    const [path, submission] = await Promise.all([
      context.params.then((params) => parsePath(params, projectPathParamsSchema)),
      parseBody(request, providerConversationImportPreviewBodySchema),
    ]);
    return jsonSuccess(
      providerConversationImportPreviewResponseSchema,
      await getWebRuntime().conversationImports.previewProviderSubmission({
        projectId: path.projectId,
        actorUserId: actor.id,
        submission,
      }),
      201,
    );
  });
}
