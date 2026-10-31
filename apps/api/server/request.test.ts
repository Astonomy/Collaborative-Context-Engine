import { describe, expect, it, vi } from "vitest";
import { DatabaseError } from "@cce/database/runtime";
import { apiErrorResponseSchema } from "@cce/api-contracts";
import { assertSameOrigin, errorResponse } from "./request";

it("explains database outages without exposing internal connection details", async () => {
  const report = vi.spyOn(console, "error").mockImplementation(() => undefined);
  try {
    const response = errorResponse(
      new DatabaseError("UNAVAILABLE", "private-password"),
      "request-test",
    );
    expect(response.status).toBe(503);
    const body = apiErrorResponseSchema.parse(await response.json());
    expect(body.error.code).toBe("DEPENDENCY_UNAVAILABLE");
    expect(body.error.message).toContain("database");
    expect(body.error.message).toContain("administrator");
    expect(body.error.message).toContain("Request ID: request-test");
    expect(JSON.stringify(body)).not.toContain("private-password");
    expect(body.error.details["requestId"]).toBe("request-test");
    const unknown = apiErrorResponseSchema.parse(
      await errorResponse(new Error("secret"), "unknown-request").json(),
    );
    expect(unknown.error.message).toContain("try again");
    expect(unknown.error.message).toContain("request ID");
    expect(JSON.stringify(unknown)).not.toContain("secret");
  } finally {
    report.mockRestore();
  }
});

describe("same-origin requests behind the standalone listener", () => {
  it("uses the HTTP host rather than the internal listening address", () => {
    const request = new Request("http://0.0.0.0:3000/api/session", {
      headers: { host: "localhost:3110", origin: "http://localhost:3110" },
    });
    expect(() => assertSameOrigin(request)).not.toThrow();
  });

  it("rejects foreign origins, missing origins and untrusted forwarded hosts", () => {
    for (const origin of [
      undefined,
      "http://attacker.example",
      "http://localhost:3001",
      "https://localhost:3000",
    ]) {
      const request = new Request("http://0.0.0.0:3000/api/session", {
        headers: {
          host: "localhost:3000",
          "x-forwarded-host": "attacker.example",
          ...(origin === undefined ? {} : { origin }),
        },
      });
      expect(() => assertSameOrigin(request)).toThrow("The request origin is not allowed.");
    }
  });

  it("retains URL-origin validation for transports without a Host header", () => {
    expect(() =>
      assertSameOrigin(
        new Request("https://cce.example/api/session", {
          headers: { origin: "https://cce.example" },
        }),
      ),
    ).not.toThrow();
  });
});
