import { expect, it } from "vitest";
import { readBrowserConfig } from "./config";
it("defaults to a coexistence base and ignores server environment", () => {
  expect(readBrowserConfig({ DATABASE_URL: "secret", CCE_SESSION_SECRET: "secret" })).toEqual({
    base: "/vue/",
  });
  expect(readBrowserConfig({ VITE_APP_BASE: "/" })).toEqual({ base: "/" });
});
it.each(["https://evil.test/", "//evil/", "/../", "/vue", "javascript:alert(1)"])(
  "rejects invalid base %s",
  (base) => {
    expect(() => readBrowserConfig({ VITE_APP_BASE: base })).toThrow();
  },
);
