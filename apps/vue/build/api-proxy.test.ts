// @vitest-environment node
import { expect, it } from "vitest";
import { forwardedOrigin } from "./api-proxy";
it("translates only the exact public origin for the existing Next host", () => {
  expect(forwardedOrigin("http://127.0.0.1:5173", "127.0.0.1:5173", "http://127.0.0.1:3000")).toBe(
    "http://127.0.0.1:3000",
  );
  expect(forwardedOrigin(undefined, "127.0.0.1:5173", "http://127.0.0.1:3000")).toBeUndefined();
});
it.each([
  "http://127.0.0.1:3000",
  "https://other.example",
  "null",
  "http://127.0.0.1:5173.evil.test",
])("keeps foreign origin %s rejected, including the upstream origin", (origin) => {
  expect(forwardedOrigin(origin, "127.0.0.1:5173", "http://127.0.0.1:3000")).toBe("null");
});
