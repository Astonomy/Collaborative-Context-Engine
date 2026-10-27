import {
  createSessionBodySchema,
  deleteSessionResponseSchema,
  sessionResponseSchema,
} from "@cce/api-contracts";

import {
  apiRoute,
  assertSameOrigin,
  jsonSuccess,
  parseBody,
  authenticateRequest,
} from "../../server/request";
import type { HttpServices } from "../../server/services";
import { clearSessionCookie, setSessionCookie } from "../../server/session-cookie";

export function createHandlers(
  getRuntime: () => Pick<HttpServices, "sessions" | "sessionCookie" | "secureCookies">,
): {
  GET: (request: Request) => Promise<Response>;
  POST: (request: Request) => Promise<Response>;
  DELETE: (request: Request) => Promise<Response>;
} {
  function GET(request: Request): Promise<Response> {
    return apiRoute(async () => {
      const user = await authenticateRequest(request, getRuntime());
      return jsonSuccess(sessionResponseSchema, { user });
    });
  }

  function POST(request: Request): Promise<Response> {
    return apiRoute(async () => {
      assertSameOrigin(request);
      const body = await parseBody(request, createSessionBodySchema);
      const runtime = getRuntime();
      const user = await runtime.sessions.authenticateApiToken(body.apiToken);
      const response = jsonSuccess(sessionResponseSchema, { user });
      setSessionCookie(response, runtime.sessionCookie.seal(body.apiToken), runtime.secureCookies);
      return response;
    });
  }

  function DELETE(request: Request): Promise<Response> {
    return apiRoute(() => {
      assertSameOrigin(request);
      const runtime = getRuntime();
      const response = Response.json(deleteSessionResponseSchema.parse({ success: true }), {
        headers: { "cache-control": "no-store" },
      });
      clearSessionCookie(response, runtime.secureCookies);
      return Promise.resolve(response);
    });
  }

  return { GET, POST, DELETE };
}
