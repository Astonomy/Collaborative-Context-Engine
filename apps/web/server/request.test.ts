import { ApplicationError } from "@cce/application";
import { describe, expect, it } from "vitest";
import { z } from "zod";

import { errorResponse, parseBody, parseQuery } from "./request";

describe("Web route boundary", () => {
  it("maps application authorization failures without leaking internals", async () => {
    const response = errorResponse(
      new ApplicationError("FORBIDDEN", "The editor role cannot approve high-risk context."),
      "00000000-0000-4000-8000-000000000999",
    );
    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "FORBIDDEN",
        message: "The editor role cannot approve high-risk context.",
        details: { requestId: "00000000-0000-4000-8000-000000000999" },
      },
    });
  });

  it("rejects a non-JSON request body before schema validation", async () => {
    const request = new Request("http://localhost/api/example", {
      method: "POST",
      body: "name=Atlas",
      headers: { "content-type": "application/x-www-form-urlencoded" },
    });
    await expect(parseBody(request, z.object({ name: z.string() }))).rejects.toThrow(
      "Content-Type must be application/json",
    );
  });

  it("rejects an oversized declared body before consuming it", async () => {
    const request = new Request("http://localhost/api/example", {
      method: "POST",
      body: "{}",
      headers: {
        "content-type": "application/json",
        "content-length": String(9 * 1_024 * 1_024),
      },
    });
    const failure = await parseBody(request, z.object({})).catch((error: unknown) => error);
    const response = errorResponse(failure, "00000000-0000-4000-8000-000000000998");
    expect(response.status).toBe(413);
  });

  it("rejects duplicated query parameters", () => {
    const request = new Request("http://localhost/api/context?kind=fact&kind=decision");
    expect(() => parseQuery(request, z.object({ kind: z.string() }))).toThrow(
      "must occur exactly once",
    );
  });
});
