import {
  confirmConversationImportBodySchema,
  conversationImportResponseSchema,
  projectPathParamsSchema,
} from "@cce/api-contracts";
import type { NextRequest } from "next/server";
import {
  apiRoute,
  authenticateRequest,
  jsonSuccess,
  parseBody,
  parsePath,
  TransportError,
} from "../../../../../server/request";
import { getWebRuntime } from "../../../../../server/runtime";
export const dynamic = "force-dynamic";
interface Context {
  readonly params: Promise<{ readonly projectId: string }>;
}
function decode(value: string): Uint8Array {
  const result = Buffer.from(value, "base64");
  if (result.length === 0) throw new TransportError("dataBase64 must be base64.");
  return result;
}
export function POST(request: NextRequest, context: Context): Promise<Response> {
  return apiRoute(async () => {
    const actor = await authenticateRequest(request);
    const [path, body] = await Promise.all([
      context.params.then((p) => parsePath(p, projectPathParamsSchema)),
      parseBody(request, confirmConversationImportBodySchema),
    ]);
    return jsonSuccess(
      conversationImportResponseSchema,
      await getWebRuntime().conversationImports.confirm({
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
