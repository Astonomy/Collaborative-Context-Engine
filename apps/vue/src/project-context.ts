import { inject, type InjectionKey, type ShallowRef } from "vue";
import type { z } from "zod";
import type { projectAccessResponseSchema } from "@cce/api-contracts";
export type ProjectAccess = z.infer<typeof projectAccessResponseSchema>;
export const projectContextKey: InjectionKey<{
  access: ShallowRef<ProjectAccess | undefined>;
  reload: () => Promise<void>;
}> = Symbol("project");
export function useProject(): {
  access: ShallowRef<ProjectAccess | undefined>;
  reload: () => Promise<void>;
} {
  const context = inject(projectContextKey);
  if (!context) throw new Error("Project context is missing.");
  return context;
}
