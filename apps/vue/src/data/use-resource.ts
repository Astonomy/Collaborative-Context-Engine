import { onScopeDispose, shallowRef, watch, type WatchSource, type ShallowRef } from "vue";
import type { z } from "zod";
import type { ApiClient, RequestScope } from "./api-client";

export function useResource<S extends z.ZodType>(
  client: ApiClient,
  path: WatchSource<string>,
  schema: S,
): {
  data: ShallowRef<z.output<S> | undefined>;
  error: ShallowRef<unknown>;
  loading: ShallowRef<boolean>;
  reload: () => Promise<void>;
} {
  const data = shallowRef<z.output<S>>();
  const error = shallowRef<unknown>();
  const loading = shallowRef(true);
  let scope: RequestScope | undefined;
  let currentPath = "";
  let version = 0;
  const reload = async (): Promise<void> => {
    const current = ++version;
    scope?.cancel();
    scope = client.scope();
    data.value = undefined;
    error.value = undefined;
    loading.value = true;
    try {
      const result = await scope.get(currentPath, schema);
      if (current === version) data.value = result;
    } catch (failure: unknown) {
      if (current === version) error.value = failure;
    } finally {
      if (current === version) loading.value = false;
    }
  };
  watch(
    path,
    (value) => {
      currentPath = value;
      void reload();
    },
    { immediate: true },
  );
  onScopeDispose(() => {
    version++;
    scope?.cancel();
  });
  return { data, error, loading, reload };
}
