import { z } from "zod";

export const jsonValueSchema = z.json();

export type JsonValue = z.infer<typeof jsonValueSchema>;

export const maximumContextValueBytes = 256 * 1_024;
export const maximumContextValueDepth = 32;
export const maximumContextValueNodes = 20_000;

export const contextValueSchema = z
  .unknown()
  .superRefine((value, context) => {
    const stack: Array<{ readonly value: unknown; readonly depth: number }> = [
      { value, depth: 0 },
    ];
    const visited = new WeakSet<object>();
    let nodes = 0;
    while (stack.length > 0) {
      const entry = stack.pop();
      if (entry === undefined) break;
      nodes += 1;
      if (nodes > maximumContextValueNodes) {
        context.addIssue({ code: "custom", message: "Context value contains too many nodes." });
        return;
      }
      if (entry.depth > maximumContextValueDepth) {
        context.addIssue({ code: "custom", message: "Context value is nested too deeply." });
        return;
      }
      if (entry.value === null || ["string", "boolean", "number"].includes(typeof entry.value)) {
        continue;
      }
      if (typeof entry.value !== "object") {
        context.addIssue({ code: "custom", message: "Context value must be valid JSON." });
        return;
      }
      if (visited.has(entry.value)) {
        context.addIssue({ code: "custom", message: "Context value cannot contain cycles." });
        return;
      }
      visited.add(entry.value);
      const children = Array.isArray(entry.value)
        ? entry.value
        : Object.values(entry.value as Record<string, unknown>);
      for (const child of children) {
        stack.push({ value: child, depth: entry.depth + 1 });
      }
    }
    let serialized: string;
    try {
      serialized = JSON.stringify(value);
    } catch {
      context.addIssue({ code: "custom", message: "Context value must be serializable JSON." });
      return;
    }
    if (utf8ByteLength(serialized) > maximumContextValueBytes) {
      context.addIssue({ code: "custom", message: "Context value exceeds 256 KiB." });
    }
  })
  .pipe(jsonValueSchema);

function utf8ByteLength(value: string): number {
  let bytes = 0;
  for (const character of value) {
    const codePoint = character.codePointAt(0) ?? 0;
    bytes += codePoint <= 0x7f ? 1 : codePoint <= 0x7ff ? 2 : codePoint <= 0xffff ? 3 : 4;
  }
  return bytes;
}
