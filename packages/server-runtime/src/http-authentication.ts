import { ApplicationError, type SessionService } from "@cce/application";
import type { User } from "@cce/domain";
import { sessionCookieName, type SessionCookieCodec } from "./session-cookie";

/** Identity only; permissions are read from persisted membership inside each use case. */
export interface AuthContext {
  readonly user: User;
}
export interface HttpAuthenticationServices {
  readonly sessions: Pick<SessionService, "authenticateApiToken">;
  readonly sessionCookie: Pick<SessionCookieCodec, "open">;
}

// Match the existing transport's last-valid-value and URI decoding semantics.
export function readCookie(request: Request, name: string): string | undefined {
  let value: string | undefined;
  for (const pair of (request.headers.get("cookie") ?? "").split(/; */)) {
    const separator = pair.indexOf("=");
    const key = separator === -1 ? pair : pair.slice(0, separator);
    if (key !== name) continue;
    try {
      value = decodeURIComponent(separator === -1 ? "true" : pair.slice(separator + 1));
    } catch {
      // A malformed cookie does not replace an earlier valid value.
    }
  }
  return value;
}

export async function authenticateHttpRequest(
  request: Request,
  runtime: HttpAuthenticationServices,
): Promise<AuthContext> {
  const authorization = request.headers.get("authorization");
  let token: string | null = null;

  if (authorization !== null) {
    const match = /^Bearer ([^\s]+)$/.exec(authorization);
    if (match?.[1] === undefined) {
      throw new ApplicationError("UNAUTHENTICATED", "Invalid Authorization header.");
    }
    token = match[1];
  } else {
    const encrypted = readCookie(request, sessionCookieName);
    token = encrypted === undefined ? null : runtime.sessionCookie.open(encrypted);
    if (token !== null && !["GET", "HEAD", "OPTIONS"].includes(request.method)) {
      assertSameOrigin(request);
    }
  }

  if (token === null) {
    throw new ApplicationError("UNAUTHENTICATED", "Authentication is required.");
  }
  return { user: await runtime.sessions.authenticateApiToken(token) };
}

export function assertSameOrigin(request: Request): void {
  const origin = request.headers.get("origin");
  const url = new URL(request.url);
  // Standalone hosts may construct request.url using their internal listening address.
  // Host is the browser's request authority; never substitute an untrusted forwarded host.
  const authority = request.headers.get("host") ?? url.host;
  if (origin === null || origin !== `${url.protocol}//${authority}`) {
    throw new ApplicationError("FORBIDDEN", "The request origin is not allowed.");
  }
}
