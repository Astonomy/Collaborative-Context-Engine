import { onScopeDispose, ref, type Ref } from "vue";
import { errorMessage } from "../errors";
import { ApiError } from "./api-client";

export function useAction(): {
  busy: Ref<boolean>;
  error: Ref<string>;
  perform: (action: (signal: AbortSignal) => Promise<void>) => Promise<void>;
} {
  const busy = ref(false);
  const error = ref("");
  const controller = new AbortController();
  onScopeDispose(() => controller.abort());
  async function perform(action: (signal: AbortSignal) => Promise<void>): Promise<void> {
    if (busy.value || controller.signal.aborted) return;
    busy.value = true;
    error.value = "";
    try {
      await action(controller.signal);
    } catch (failure: unknown) {
      if (!controller.signal.aborted)
        error.value =
          failure instanceof ApiError && failure.status === 409
            ? `Conflict: ${failure.message} Reload the latest state and review before trying again.`
            : errorMessage(failure);
    } finally {
      busy.value = false;
    }
  }
  return { busy, error, perform };
}
