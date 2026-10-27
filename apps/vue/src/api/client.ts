import { apiErrorResponseSchema, type AttachmentResponse } from "@cce/api-contracts";
import type { UploadTarget } from "../attachments/upload";
import { z } from "zod";

export class ApiError extends Error {
  public constructor(
    public readonly status: number,
    message: string,
    public readonly requestId?: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export function readApiBaseUrl(value: unknown): string {
  if (value === undefined || value === "") return "";
  const url = new URL(z.string().parse(value));
  if (
    !["http:", "https:"].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.pathname !== "/" ||
    url.search ||
    url.hash
  )
    throw new Error("Invalid CCE API origin.");
  return url.origin;
}
export const apiCredentials: RequestCredentials = "include";
export function apiUrl(
  path: string,
  base = readApiBaseUrl(import.meta.env["VITE_CCE_API_BASE_URL"]),
): string {
  return base + apiPath(path);
}
export function apiPath(path: string): string {
  const pathname = path.split("?")[0] ?? "";
  if (!/^\/api\/[a-zA-Z0-9/_-]+$/.test(pathname) || pathname.includes("//") || path.includes("#"))
    throw new Error("Invalid API path.");
  return path;
}

export async function requireSuccess(response: Response): Promise<Response> {
  if (response.ok) return response;
  const payload: unknown = await response.json().catch(() => null);
  const parsed = apiErrorResponseSchema.safeParse(payload);
  throw new ApiError(
    response.status,
    parsed.success ? parsed.data.error.message : `Request failed (HTTP ${response.status}).`,
    response.headers.get("x-request-id") ?? undefined,
  );
}

export class ApiClient {
  private readonly active = new Set<AbortController>();
  public constructor(
    private readonly transport: typeof fetch = fetch,
    private readonly onUnauthorized: () => void = () => undefined,
    private readonly baseUrl = readApiBaseUrl(import.meta.env["VITE_CCE_API_BASE_URL"]),
  ) {}

  public url(path: string): string {
    return apiUrl(path, this.baseUrl);
  }
  public async request(path: string, init: RequestInit = {}): Promise<Response> {
    try {
      return await requireSuccess(
        await this.transport.call(globalThis, this.url(path), {
          ...init,
          credentials: apiCredentials,
          cache: "no-store",
          redirect: "error",
        }),
      );
    } catch (error: unknown) {
      if (error instanceof ApiError && error.status === 401) this.onUnauthorized();
      throw error;
    }
  }
  public cancelAll(): void {
    for (const controller of this.active) controller.abort();
    this.active.clear();
  }

  public async upload(
    target: UploadTarget,
    file: File,
    clientMessageId: string,
    progress: (percent: number) => void,
    outerSignal: AbortSignal,
  ): Promise<AttachmentResponse> {
    const controller = new AbortController();
    this.active.add(controller);
    const signal = AbortSignal.any([controller.signal, outerSignal]);
    try {
      const { uploadFile } = await import("../attachments/upload");
      return await uploadFile(target, file, clientMessageId, signal, progress, this.url.bind(this));
    } catch (error: unknown) {
      if (error instanceof ApiError && error.status === 401) this.onUnauthorized();
      throw error;
    } finally {
      this.active.delete(controller);
    }
  }

  public async json<S extends z.ZodType>(
    path: string,
    schema: S,
    init: RequestInit = {},
  ): Promise<z.output<S>> {
    const controller = new AbortController();
    this.active.add(controller);
    const signal = init.signal
      ? AbortSignal.any([controller.signal, init.signal])
      : controller.signal;
    try {
      signal.throwIfAborted();
      const headers = new Headers(init.headers);
      if (init.body !== undefined) headers.set("content-type", "application/json");
      const response = await this.request(path, { ...init, headers, signal });
      signal.throwIfAborted();
      await requireSuccess(response);
      const payload: unknown = await response.json();
      signal.throwIfAborted();
      return schema.parse(payload);
    } catch (error: unknown) {
      if (error instanceof ApiError) throw error;
      signal.throwIfAborted();
      throw error;
    } finally {
      this.active.delete(controller);
    }
  }

  public scope(): RequestScope {
    return new RequestScope(this);
  }
}

// Dedupe only in-flight GETs within one route/resource lifetime; no global server cache.
export class RequestScope {
  private readonly controller = new AbortController();
  private readonly pending = new Map<string, Promise<unknown>>();
  public constructor(private readonly client: ApiClient) {}
  public cancel(): void {
    this.controller.abort();
    this.pending.clear();
  }
  public async get<S extends z.ZodType>(path: string, schema: S): Promise<z.output<S>> {
    this.controller.signal.throwIfAborted();
    let pending = this.pending.get(path);
    if (pending === undefined) {
      pending = this.client.json(path, z.unknown(), { signal: this.controller.signal });
      this.pending.set(path, pending);
    }
    try {
      const payload = await pending;
      this.controller.signal.throwIfAborted();
      return schema.parse(payload);
    } finally {
      if (this.pending.get(path) === pending) this.pending.delete(path);
    }
  }
}
