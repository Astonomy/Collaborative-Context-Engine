// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { ApiClient, ApiError, apiPath, readApiBaseUrl } from "./api-client";

const schema = z.object({ value: z.string() }).strict();
describe("same-origin API requests", () => {
  it("calls the browser fetch with its global receiver", async () => {
    const transport: typeof fetch = function (this: unknown) {
      if (this !== globalThis) throw new TypeError("Illegal invocation");
      return Promise.resolve(Response.json({ value: "ok" }));
    };
    expect(await new ApiClient(transport).json("/api/projects", schema)).toEqual({ value: "ok" });
  });
  it("validates data and preserves cookie semantics", async () => {
    const transport = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ value: "ok" }));
    expect(await new ApiClient(transport).json("/api/projects", schema)).toEqual({ value: "ok" });
    expect(transport).toHaveBeenCalledWith(
      "/api/projects",
      expect.objectContaining({ credentials: "include", cache: "no-store", redirect: "error" }),
    );
  });
  it.each([
    "https://evil.test/api/projects",
    "//evil.test",
    "/api/../session",
    "/api//projects",
    "/api/x#fragment",
  ])("rejects unsafe path %s", (path) => {
    expect(() => apiPath(path)).toThrow();
  });
  it.each([401, 403, 404, 409, 413, 429, 503])("reports HTTP %i and request ID", async (status) => {
    const unauthorized = vi.fn();
    const client = new ApiClient(
      vi
        .fn<typeof fetch>()
        .mockResolvedValue(
          Response.json(
            { error: { code: "FORBIDDEN", message: "Denied", details: {} } },
            { status, headers: { "x-request-id": "request-1" } },
          ),
        ),
      unauthorized,
    );
    await expect(client.json("/api/projects", schema)).rejects.toMatchObject({
      status,
      message: "Denied",
      requestId: "request-1",
    });
    expect(unauthorized).toHaveBeenCalledTimes(status === 401 ? 1 : 0);
  });
  it("handles non-JSON failures, network failures and invalid success DTOs", async () => {
    await expect(
      new ApiClient(
        vi.fn<typeof fetch>().mockResolvedValue(new Response("gateway", { status: 503 })),
      ).json("/api/projects", schema),
    ).rejects.toBeInstanceOf(ApiError);
    await expect(
      new ApiClient(vi.fn<typeof fetch>().mockRejectedValue(new TypeError("offline"))).json(
        "/api/projects",
        schema,
      ),
    ).rejects.toThrow("offline");
    await expect(
      new ApiClient(vi.fn<typeof fetch>().mockResolvedValue(Response.json({ value: 1 }))).json(
        "/api/projects",
        schema,
      ),
    ).rejects.toThrow();
  });
  it("deduplicates concurrent GETs only until settled", async () => {
    const transport = vi
      .fn<typeof fetch>()
      .mockImplementation(() => Promise.resolve(Response.json({ value: "ok" })));
    const scope = new ApiClient(transport).scope();
    expect(
      await Promise.all([scope.get("/api/projects", schema), scope.get("/api/projects", schema)]),
    ).toHaveLength(2);
    expect(transport).toHaveBeenCalledTimes(1);
    await scope.get("/api/projects", schema);
    expect(transport).toHaveBeenCalledTimes(2);
  });
  it("cancels a scope without cancelling another and discards late transport results", async () => {
    const deferred = Promise.withResolvers<Response>();
    const transport = vi
      .fn<typeof fetch>()
      .mockReturnValueOnce(deferred.promise)
      .mockResolvedValueOnce(Response.json({ value: "other" }));
    const client = new ApiClient(transport);
    const scope = client.scope();
    const pending = scope.get("/api/projects", schema);
    scope.cancel();
    deferred.resolve(Response.json({ value: "stale" }));
    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
    await expect(scope.get("/api/projects", schema)).rejects.toMatchObject({ name: "AbortError" });
    expect(await client.scope().get("/api/projects", schema)).toEqual({ value: "other" });
  });
  it("never deduplicates mutations and sets JSON content type", async () => {
    const transport = vi
      .fn<typeof fetch>()
      .mockImplementation(() => Promise.resolve(Response.json({ value: "ok" })));
    const client = new ApiClient(transport);
    await Promise.all([
      client.json("/api/session", schema, { method: "POST", body: "{}" }),
      client.json("/api/session", schema, { method: "POST", body: "{}" }),
    ]);
    expect(transport).toHaveBeenCalledTimes(2);
    expect(new Headers(transport.mock.calls[0]?.[1]?.headers).get("content-type")).toBe(
      "application/json",
    );
  });
});

it("routes requests to the configured standalone origin", async () => {
  const transport = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ value: "ok" }));
  await new ApiClient(transport, undefined, "https://api.example.test").json(
    "/api/session",
    schema,
  );
  expect(transport).toHaveBeenCalledWith(
    "https://api.example.test/api/session",
    expect.objectContaining({ credentials: "include" }),
  );
});
it.each([
  "ftp://api.test",
  "https://user:pass@api.test",
  "https://api.test/path",
  "https://api.test/?secret=x",
])("rejects invalid API origin %s", (value) => {
  expect(() => readApiBaseUrl(value)).toThrow();
});
