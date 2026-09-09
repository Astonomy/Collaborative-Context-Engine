import { handleCceMcpRequest } from "@cce/mcp-server";
import type { NextRequest } from "next/server";

import { apiRoute, authenticateRequest, readBoundedRequestJson } from "../../server/request";
import { getWebRuntime } from "../../server/runtime";

export const dynamic = "force-dynamic";

async function handle(request: NextRequest): Promise<Response> {
  return apiRoute(async () => {
    const actor = await authenticateRequest(request);
    const runtime = getWebRuntime();
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

export function GET(request: NextRequest): Promise<Response> {
  return handle(request);
}

export function POST(request: NextRequest): Promise<Response> {
  return handle(request);
}

export function DELETE(request: NextRequest): Promise<Response> {
  return handle(request);
}
