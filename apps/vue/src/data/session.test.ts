// @vitest-environment node
import { expect, it, vi } from "vitest";
import { createSession } from "./session";

const user = {
  id: "00000000-0000-4000-8000-000000000001",
  displayName: "Test User",
  email: "test@example.com",
  createdAt: "2026-01-01T00:00:00.000Z",
};
const unauthorized = (): Response =>
  Response.json(
    { error: { code: "UNAUTHENTICATED", message: "Sign in", details: {} } },
    { status: 401 },
  );
it("bootstraps once, logs in with cookies and clears state on logout", async () => {
  const transport = vi
    .fn<typeof fetch>()
    .mockResolvedValueOnce(unauthorized())
    .mockResolvedValueOnce(Response.json({ user }))
    .mockResolvedValueOnce(Response.json({ success: true }));
  const session = createSession(transport);
  await Promise.all([session.bootstrap(), session.bootstrap()]);
  expect(transport).toHaveBeenCalledTimes(1);
  expect(session.ready.value).toBe(true);
  expect(session.user.value).toBeNull();
  await session.login("cce_test_token_long_enough_for_validation_123456789");
  expect(session.user.value).toEqual(user);
  await session.bootstrap();
  expect(transport).toHaveBeenCalledTimes(2);
  await session.logout();
  expect(session.user.value).toBeNull();
});
it("does not convert an unavailable backend to an anonymous session; permits retry", async () => {
  const transport = vi
    .fn<typeof fetch>()
    .mockResolvedValueOnce(new Response(null, { status: 503 }))
    .mockResolvedValueOnce(Response.json({ user }));
  const session = createSession(transport);
  await expect(session.bootstrap()).rejects.toThrow();
  expect(session.ready.value).toBe(false);
  await session.bootstrap();
  expect(session.user.value).toEqual(user);
});
it("logout cancels pending bootstrap and cannot restore the previous identity", async () => {
  const deferred = Promise.withResolvers<Response>();
  const transport = vi
    .fn<typeof fetch>()
    .mockReturnValueOnce(deferred.promise)
    .mockResolvedValueOnce(Response.json({ success: true }));
  const session = createSession(transport);
  const bootstrap = session.bootstrap();
  await session.logout();
  deferred.resolve(Response.json({ user }));
  await expect(bootstrap).rejects.toMatchObject({ name: "AbortError" });
  expect(session.user.value).toBeNull();
});
