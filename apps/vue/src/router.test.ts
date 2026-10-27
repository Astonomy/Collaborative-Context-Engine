import { createMemoryHistory } from "vue-router";
import { expect, it, vi } from "vitest";
import { createSession } from "./data/session";
import { appRouter } from "./router";
import { errorMessage } from "./errors";
import { ApiError } from "./data/api-client";
import { sessionResponseSchema } from "@cce/api-contracts";

const user = {
  id: "00000000-0000-4000-8000-000000000001",
  displayName: "Test",
  email: "test@example.com",
  createdAt: "2026-01-01T00:00:00.000Z",
};
it("guards deep links, allows not-found and redirects authenticated login", async () => {
  const session = createSession(
    vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        Response.json({ error: { code: "UNAUTHENTICATED", message: "Sign in" } }, { status: 401 }),
      ),
  );
  const router = appRouter(session, "/vue/", vi.fn(), createMemoryHistory());
  await router.push("/projects/123/conversations");
  expect(router.currentRoute.value.name).toBe("login");
  await router.push("/missing");
  expect(router.currentRoute.value.matched[0]?.path).toBe("/:pathMatch(.*)*");
  session.user.value = sessionResponseSchema.parse({ user }).user;
  await router.push("/login");
  expect(router.currentRoute.value.name).toBe("projects");
  await router.push("/projects/123");
  expect(router.currentRoute.value.name).toBe("project");
  await router.push("/projects/123/conversations");
  expect(router.currentRoute.value.name).toBe("conversations");
  for (const [path, name] of [
    ["conversations/456", "conversation"],
    ["context", "context"],
    ["history", "history"],
    ["merges/789", "merges"],
  ]) {
    await router.push("/projects/123/" + path);
    expect(router.currentRoute.value.name).toBe(name);
  }
});
it("reports bootstrap failures without treating them as logged out", async () => {
  const session = createSession(vi.fn<typeof fetch>().mockRejectedValue(new Error("offline")));
  const report = vi.fn();
  const router = appRouter(session, "/vue/", report, createMemoryHistory());
  await router.push("/projects");
  expect(report).toHaveBeenCalledOnce();
});
it("shows safe errors including resource-not-found and hides unexpected details", () => {
  expect(errorMessage(new ApiError(404, "private"))).toContain("not found");
  expect(errorMessage(new ApiError(429, "Slow down"))).toBe("Slow down");
  expect(errorMessage(new Error("secret"))).not.toContain("secret");
});
