import type { JsonValue } from "@cce/shared";

function isJsonObject(value: JsonValue): value is { readonly [key: string]: JsonValue } {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function canonicalizeJson(value: JsonValue): JsonValue {
  if (Array.isArray(value)) {
    return value.map((entry) => canonicalizeJson(entry));
  }
  if (isJsonObject(value)) {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entry]) => [key, canonicalizeJson(entry)]),
    );
  }
  return value;
}

export function normalizeJson(value: JsonValue): JsonValue {
  return canonicalizeJson(value);
}

export function stableStringify(value: JsonValue): string {
  return JSON.stringify(canonicalizeJson(value));
}

export function normalizedJsonEquals(left: JsonValue, right: JsonValue): boolean {
  return stableStringify(normalizeJson(left)) === stableStringify(normalizeJson(right));
}

export interface CompatibleExpansion {
  readonly compatible: true;
  readonly value: JsonValue;
}

export interface IncompatibleExpansion {
  readonly compatible: false;
}

export function mergeCompatibleJson(
  current: JsonValue,
  proposed: JsonValue,
): CompatibleExpansion | IncompatibleExpansion {
  if (Array.isArray(current) && Array.isArray(proposed)) {
    return normalizedJsonEquals(current, proposed)
      ? { compatible: true, value: canonicalizeJson(current) }
      : { compatible: false };
  }

  if (!isJsonObject(current) || !isJsonObject(proposed)) {
    return { compatible: false };
  }

  const merged: Record<string, JsonValue> = { ...current };
  for (const [key, proposedValue] of Object.entries(proposed)) {
    const currentValue = current[key];
    if (currentValue === undefined) {
      merged[key] = proposedValue;
      continue;
    }
    if (!normalizedJsonEquals(currentValue, proposedValue)) {
      return { compatible: false };
    }
  }
  return { compatible: true, value: canonicalizeJson(merged) };
}
