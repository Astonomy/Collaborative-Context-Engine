import { contextScopeIdentity, type ContextItemVersion } from "@cce/domain";

type Scope = ContextItemVersion["scope"];

export function scopeIdentity(scope: Scope): string {
  return contextScopeIdentity(scope);
}

export function scopesAreDisjoint(left: Scope, right: Scope): boolean {
  for (const dimension of ["component", "environment", "audience"] as const) {
    if (
      left[dimension] !== undefined &&
      right[dimension] !== undefined &&
      left[dimension] !== right[dimension]
    ) {
      return true;
    }
  }

  if (
    left.effectiveTo !== undefined &&
    right.effectiveFrom !== undefined &&
    Date.parse(left.effectiveTo) <= Date.parse(right.effectiveFrom)
  ) {
    return true;
  }
  if (
    right.effectiveTo !== undefined &&
    left.effectiveFrom !== undefined &&
    Date.parse(right.effectiveTo) <= Date.parse(left.effectiveFrom)
  ) {
    return true;
  }
  return false;
}

export function sameContextSlot(
  left: Pick<ContextItemVersion, "key" | "kind" | "scope">,
  right: Pick<ContextItemVersion, "key" | "kind" | "scope">,
): boolean {
  return (
    left.key === right.key &&
    left.kind === right.kind &&
    scopeIdentity(left.scope) === scopeIdentity(right.scope)
  );
}
