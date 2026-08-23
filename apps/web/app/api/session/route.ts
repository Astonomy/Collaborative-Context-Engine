import {
  createSessionBodySchema,
  deleteSessionResponseSchema,
  sessionResponseSchema,
} from "@cce/api-contracts";
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import {
  apiRoute,
  assertSameOrigin,
  jsonSuccess,
  parseBody,
  authenticateRequest,
} from "../../../server/request";
import { getWebRuntime } from "../../../server/runtime";
import { clearSessionCookie, setSessionCookie } from "../../../server/session-cookie";

export const dynamic = "force-dynamic";

export function GET(request: NextRequest): Promise<Response> {
  return apiRoute(async () => {
    const user = await authenticateRequest(request);
    return jsonSuccess(sessionResponseSchema, { user });
  });
}

export function POST(request: NextRequest): Promise<Response> {
  return apiRoute(async () => {
    assertSameOrigin(request);
    const body = await parseBody(request, createSessionBodySchema);
    const runtime = getWebRuntime();
    const user = await runtime.sessions.authenticateApiToken(body.apiToken);
    const response = jsonSuccess(sessionResponseSchema, { user });
    setSessionCookie(response, runtime.sessionCookie.seal(body.apiToken), runtime.secureCookies);
    return response;
  });
}

export function DELETE(request: NextRequest): Promise<Response> {
  return apiRoute(() => {
    assertSameOrigin(request);
    const runtime = getWebRuntime();
    const response = NextResponse.json(deleteSessionResponseSchema.parse({ success: true }), {
      headers: { "cache-control": "no-store" },
    });
    clearSessionCookie(response, runtime.secureCookies);
    return Promise.resolve(response);
  });
}
