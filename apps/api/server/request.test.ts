import { describe, expect, it } from "vitest";
import { assertSameOrigin } from "./request";

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
