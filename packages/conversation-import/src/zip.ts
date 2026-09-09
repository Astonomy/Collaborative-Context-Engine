import { inflateRawSync } from "node:zlib";
import { ConversationImportError, type ImportLimits } from "./types";

const u16 = (b: Uint8Array, o: number): number => (b[o] ?? 0) | ((b[o + 1] ?? 0) << 8);
const u32 = (b: Uint8Array, o: number): number => (u16(b, o) + u16(b, o + 2) * 65536) >>> 0;

export function readBoundedZip(
  bytes: Uint8Array,
  limits: ImportLimits,
): ReadonlyMap<string, Uint8Array> {
  const files = new Map<string, Uint8Array>();
  let offset = 0,
    expanded = 0,
    entries = 0;
  while (offset + 4 <= bytes.length && u32(bytes, offset) === 0x04034b50) {
    if (++entries > limits.maximumFiles)
      throw new ConversationImportError("LIMIT_EXCEEDED", "Archive contains too many files.");
    if (offset + 30 > bytes.length)
      throw new ConversationImportError("MALFORMED", "ZIP local header is truncated.");
    const flags = u16(bytes, offset + 6),
      method = u16(bytes, offset + 8);
    const compressed = u32(bytes, offset + 18),
      size = u32(bytes, offset + 22);
    const nameLength = u16(bytes, offset + 26),
      extraLength = u16(bytes, offset + 28);
    if ((flags & 0x08) !== 0 || (flags & 0x01) !== 0)
      throw new ConversationImportError(
        "UNSUPPORTED",
        "ZIP data descriptors and encryption are not supported.",
      );
    const nameStart = offset + 30,
      dataStart = nameStart + nameLength + extraLength,
      dataEnd = dataStart + compressed;
    if (dataEnd > bytes.length)
      throw new ConversationImportError("MALFORMED", "ZIP entry is truncated.");
    const name = new TextDecoder("utf-8", { fatal: true })
      .decode(bytes.subarray(nameStart, nameStart + nameLength))
      .replaceAll("\\", "/");
    if (name.startsWith("/") || /^[A-Za-z]:/.test(name) || name.split("/").includes(".."))
      throw new ConversationImportError("MALFORMED", "ZIP entry has an unsafe path.");
    if (!name.endsWith("/")) {
      if (size > limits.maximumExpandedBytes || expanded + size > limits.maximumExpandedBytes)
        throw new ConversationImportError(
          "LIMIT_EXCEEDED",
          "Archive expands beyond the allowed size.",
        );
      const source = bytes.subarray(dataStart, dataEnd);
      const output =
        method === 0
          ? source.slice()
          : method === 8
            ? inflateRawSync(source, { maxOutputLength: limits.maximumExpandedBytes - expanded })
            : null;
      if (output === null)
        throw new ConversationImportError(
          "UNSUPPORTED",
          `ZIP compression method ${method} is unsupported.`,
        );
      if (output.byteLength !== size)
        throw new ConversationImportError("MALFORMED", "ZIP entry size does not match its header.");
      expanded += output.byteLength;
      files.set(name, output);
    }
    offset = dataEnd;
  }
  if (entries === 0)
    throw new ConversationImportError("MALFORMED", "ZIP contains no readable local entries.");
  return files;
}
