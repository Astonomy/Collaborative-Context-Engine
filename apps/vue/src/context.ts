import { inject, type InjectionKey, type ShallowRef } from "vue";
import type { Session } from "./data/session";

export interface AppContext {
  session: Session;
  fatal: ShallowRef<string | null>;
}
export const appContextKey: InjectionKey<AppContext> = Symbol("cce-app");
export function useAppContext(): AppContext {
  const context = inject(appContextKey);
  if (!context) throw new Error("CCE application context is missing.");
  return context;
}
