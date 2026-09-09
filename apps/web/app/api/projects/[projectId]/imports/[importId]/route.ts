import { conversationImportPathSchema, conversationImportResponseSchema } from "@cce/api-contracts";
import type { NextRequest } from "next/server";
import {
  apiRoute,
  authenticateRequest,
  jsonSuccess,
  parsePath,
} from "../../../../../../server/request";
import { getWebRuntime } from "../../../../../../server/runtime";
export const dynamic = "force-dynamic";
interface Context {
  readonly params: Promise<{ readonly projectId: string; readonly importId: string }>;
}
export function GET(request: NextRequest, context: Context): Promise<Response> {
  return apiRoute(async () => {
    const actor = await authenticateRequest(request);
    const path = parsePath(await context.params, conversationImportPathSchema);
    return jsonSuccess(
      conversationImportResponseSchema,
      await getWebRuntime().conversationImports.get(path.projectId, actor.id, path.importId),
    );
  });
}
