// @vitest-environment node
import { effectScope, isReactive, nextTick, shallowRef } from "vue";
import { expect, it, vi } from "vitest";
import { z } from "zod";
import { ApiClient } from "./api-client";
import { useResource } from "./use-resource";

it("replaces shallow server data and suppresses old project results", async () => {
  const old = Promise.withResolvers<Response>();
  const transport = vi
    .fn<typeof fetch>()
    .mockReturnValueOnce(old.promise)
    .mockResolvedValueOnce(Response.json({ nested: { name: "new" } }));
  const path = shallowRef("/api/projects/old");
  const scope = effectScope();
  const resource = scope.run(() =>
    useResource(
      new ApiClient(transport),
      path,
      z.object({ nested: z.object({ name: z.string() }) }),
    ),
  );
  if (!resource) throw new Error("Missing resource");
  path.value = "/api/projects/new";
  await nextTick();
  await vi.waitFor(() => expect(resource.data.value?.nested.name).toBe("new"));
  old.resolve(Response.json({ nested: { name: "old" } }));
  await nextTick();
  expect(resource.data.value?.nested.name).toBe("new");
  expect(isReactive(resource.data.value?.nested)).toBe(false);
  scope.stop();
});
it("exposes errors and retry, cancels on disposal", async () => {
  const transport = vi
    .fn<typeof fetch>()
    .mockRejectedValueOnce(new Error("offline"))
    .mockResolvedValueOnce(Response.json("ready"));
  const scope = effectScope();
  const resource = scope.run(() =>
    useResource(new ApiClient(transport), () => "/api/projects", z.string()),
  );
  if (!resource) throw new Error("Missing resource");
  await vi.waitFor(() => expect(resource.loading.value).toBe(false));
  expect(resource.error.value).toBeInstanceOf(Error);
  await resource.reload();
  expect(resource.data.value).toBe("ready");
  expect(resource.error.value).toBeUndefined();
  scope.stop();
});
