// @vitest-environment node
import { afterEach, expect, it, vi } from "vitest";
import { readContent } from "./read-content";
afterEach(() => vi.unstubAllGlobals());
it("reads bounded bytes with same-origin credentials and no redirect", async () => {
  const transport = vi.fn().mockResolvedValue(new Response(new Uint8Array([1, 2, 3])));
  vi.stubGlobal("fetch", transport);
  expect(
    new Uint8Array(await readContent("/api/attachment/content", 3, new AbortController().signal)),
  ).toEqual(new Uint8Array([1, 2, 3]));
  expect(transport).toHaveBeenCalledWith(
    "/api/attachment/content",
    expect.objectContaining({ credentials: "include", redirect: "error", cache: "no-store" }),
  );
});
it("cancels oversized response streams and propagates unavailable responses", async () => {
  const cancel = vi.fn();
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue(
      new Response(
        new ReadableStream({
          start(controller) {
            controller.enqueue(new Uint8Array(4));
          },
          cancel,
        }),
      ),
    ),
  );
  await expect(
    readContent("/api/attachment/content", 3, new AbortController().signal),
  ).rejects.toThrow("limit");
  expect(cancel).toHaveBeenCalled();
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, { status: 403 })));
  await expect(
    readContent("/api/attachment/content", 3, new AbortController().signal),
  ).rejects.toMatchObject({ status: 403 });
});
