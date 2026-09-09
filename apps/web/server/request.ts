import { randomUUID } from "node:crypto";

import { apiErrorResponseSchema, type ApiErrorResponse } from "@cce/api-contracts";
import { ApplicationError, ModelProviderError } from "@cce/application";
import { DatabaseError } from "@cce/database/runtime";
import { DomainError, type User } from "@cce/domain";
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { z } from "zod";

import { getWebRuntime } from "./runtime";
import { sessionCookieName } from "./session-cookie";

export class TransportError extends Error {
  public readonly status: 400 | 413;

  public constructor(message: string, status: 400 | 413 = 400) {
    super(message);
    this.name = "TransportError";
    this.status = status;
  }
}

const maximumRequestBodyBytes = 8 * 1_024 * 1_024;

export async function parseBody<Schema extends z.ZodType>(
  request: Request,
  schema: Schema,
): Promise<z.output<Schema>> {
  const contentType = request.headers.get("content-type")?.toLowerCase() ?? "";
  if (!contentType.includes("application/json")) {
    throw new TransportError("Content-Type must be application/json.");
  }
  try {
    return schema.parse(await readBoundedRequestJson(request));
  } catch (error: unknown) {
    if (error instanceof z.ZodError || error instanceof TransportError) {
      throw error;
    }
    throw new TransportError("Request body must contain valid JSON.");
  }
}

export async function readBoundedRequestJson(request: Request): Promise<unknown> {
  try {
    return JSON.parse(await readBoundedRequestText(request)) as unknown;
  } catch (error: unknown) {
    if (error instanceof TransportError) throw error;
    throw new TransportError("Request body must contain valid JSON.");
  }
}

async function readBoundedRequestText(request: Request): Promise<string> {
  const declaredLength = request.headers.get("content-length");
  if (declaredLength !== null) {
    if (!/^\d+$/.test(declaredLength)) {
      throw new TransportError("Content-Length must be a non-negative integer.");
    }
    if (Number(declaredLength) > maximumRequestBodyBytes) {
      throw new TransportError("Request body exceeds the allowed size.", 413);
    }
  }
  if (request.body === null) {
    throw new TransportError("Request body is required.");
  }

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let received = 0;
  while (true) {
    const chunk = await reader.read();
    if (chunk.done) {
      break;
    }
    received += chunk.value.byteLength;
    if (received > maximumRequestBodyBytes) {
      await reader.cancel().catch(() => undefined);
      throw new TransportError("Request body exceeds the allowed size.", 413);
    }
    chunks.push(chunk.value);
  }

  const body = new Uint8Array(received);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(body);
  } catch {
    throw new TransportError("Request body must be valid UTF-8.");
  }
}

export function parsePath<Schema extends z.ZodType>(
  value: unknown,
  schema: Schema,
): z.output<Schema> {
  return schema.parse(value);
}

export function parseQuery<Schema extends z.ZodType>(
  request: Request,
  schema: Schema,
): z.output<Schema> {
  const values: Record<string, string> = {};
  const query = new URL(request.url).searchParams;
  for (const key of new Set(query.keys())) {
    const entries = query.getAll(key);
    if (entries.length !== 1 || entries[0] === undefined) {
      throw new TransportError(`Query parameter ${key} must occur exactly once.`);
    }
    values[key] = entries[0];
  }
  return schema.parse(values);
}

export async function authenticateRequest(request: NextRequest): Promise<User> {
  const runtime = getWebRuntime();
  const authorization = request.headers.get("authorization");
  let token: string | null = null;

  if (authorization !== null) {
    const match = /^Bearer ([^\s]+)$/.exec(authorization);
    if (match?.[1] === undefined) {
      throw new ApplicationError("UNAUTHENTICATED", "Invalid Authorization header.");
    }
    token = match[1];
  } else {
    const encrypted = request.cookies.get(sessionCookieName)?.value;
    token = encrypted === undefined ? null : runtime.sessionCookie.open(encrypted);
    if (token !== null && !["GET", "HEAD", "OPTIONS"].includes(request.method)) {
      assertSameOrigin(request);
    }
  }

  if (token === null) {
    throw new ApplicationError("UNAUTHENTICATED", "Authentication is required.");
  }
  return runtime.sessions.authenticateApiToken(token);
}

export function assertSameOrigin(request: Request): void {
  const origin = request.headers.get("origin");
  if (origin === null || origin !== new URL(request.url).origin) {
    throw new ApplicationError("FORBIDDEN", "The request origin is not allowed.");
  }
}

export function jsonSuccess<Schema extends z.ZodType>(
  schema: Schema,
  value: unknown,
  status = 200,
): NextResponse<z.output<Schema>> {
  return NextResponse.json(schema.parse(value), {
    status,
    headers: { "cache-control": "no-store" },
  });
}

export async function apiRoute(
  operation: (requestId: string) => Promise<Response>,
): Promise<Response> {
  const requestId = randomUUID();
  try {
    const response = await operation(requestId);
    response.headers.set("x-request-id", requestId);
    return response;
  } catch (error: unknown) {
    return errorResponse(error, requestId);
  }
}

export function errorResponse(
  error: unknown,
  requestId: string = randomUUID(),
): NextResponse<ApiErrorResponse> {
  const mapped = mapError(error);
  if (mapped.status >= 500) {
    console.error("CCE request failed", { requestId, error });
  }
  const payload = apiErrorResponseSchema.parse({
    error: {
      code: mapped.code,
      message: mapped.message,
      details: { ...mapped.details, requestId },
    },
  });
  return NextResponse.json(payload, {
    status: mapped.status,
    headers: {
      "cache-control": "no-store",
      "x-request-id": requestId,
    },
  });
}

interface MappedError {
  readonly status: number;
  readonly code: ApiErrorResponse["error"]["code"];
  readonly message: string;
  readonly details: Readonly<Record<string, string>>;
}

function mapError(error: unknown): MappedError {
  if (error instanceof TransportError) {
    return {
      status: error.status,
      code: "VALIDATION",
      message: "The request is invalid.",
      details: { reason: error.message },
    };
  }
  if (error instanceof z.ZodError) {
    return {
      status: 400,
      code: "VALIDATION",
      message: "The request is invalid.",
      details: Object.fromEntries(
        error.issues
          .slice(0, 10)
          .map((issue, index) => [
            `issue.${index}`,
            `${issue.path.join(".") || "request"}: ${issue.message}`,
          ]),
      ),
    };
  }
  if (error instanceof ApplicationError) {
    const statusByCode = {
      UNAUTHENTICATED: 401,
      FORBIDDEN: 403,
      NOT_FOUND: 404,
      CONFLICT: 409,
      VALIDATION: 422,
      DEPENDENCY_UNAVAILABLE: 503,
    } as const;
    return {
      status: statusByCode[error.code],
      code: error.code === "DEPENDENCY_UNAVAILABLE" ? "DEPENDENCY_UNAVAILABLE" : error.code,
      message: error.message,
      details: error.details,
    };
  }
  if (error instanceof DomainError) {
    return {
      status: error.code === "STALE_CONTEXT_HEAD" ? 409 : 422,
      code: error.code === "STALE_CONTEXT_HEAD" ? "CONFLICT" : "UNPROCESSABLE_ENTITY",
      message: error.message,
      details: { domainCode: error.code },
    };
  }
  if (error instanceof DatabaseError) {
    const status = error.code === "WRITE_CONFLICT" ? 409 : error.code === "NOT_FOUND" ? 404 : 500;
    return {
      status,
      code: status === 409 ? "CONFLICT" : status === 404 ? "NOT_FOUND" : "INTERNAL_ERROR",
      message: status >= 500 ? "The persisted data could not be read safely." : error.message,
      details: { databaseCode: error.code },
    };
  }
  if (error instanceof ModelProviderError) {
    return {
      status: error.code === "RATE_LIMIT" ? 429 : 503,
      code: error.code === "RATE_LIMIT" ? "RATE_LIMITED" : "DEPENDENCY_UNAVAILABLE",
      message:
        error.code === "RATE_LIMIT"
          ? "The model provider rate limit was reached."
          : "The model provider is unavailable.",
      details: { providerCode: error.code },
    };
  }
  return {
    status: 500,
    code: "INTERNAL_ERROR",
    message: "An unexpected server error occurred.",
    details: {},
  };
}
