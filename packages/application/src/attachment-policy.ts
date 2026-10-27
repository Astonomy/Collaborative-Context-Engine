import { attachmentMimeTypeSchema, type Attachment } from "@cce/domain";
import { ApplicationError } from "./errors";
import type { ByteRange } from "./attachment-storage";

export const maximumAttachmentBytes = 100 * 1024 * 1024;

export function normalizeAttachmentFilename(value: string): string {
  const name = value
    .normalize("NFKC")
    .split(/[\\/]/)
    .at(-1)
    ?.replace(/[\p{Cc}\p{Cf}]/gu, "")
    .trim();
  if (!name || name === "." || name === ".." || name.length > 255) {
    throw new ApplicationError("VALIDATION", "Invalid attachment filename.");
  }
  if (
    /(?:^|\.)(?:exe|com|bat|cmd|ps1|sh|js|mjs|cjs|html?|svg|scr|msi|dll|lnk|url|jar|vbs|hta)(?:\.|$)/i.test(
      name,
    )
  ) {
    throw new ApplicationError(
      "VALIDATION",
      "Executable or active file extensions are not accepted.",
    );
  }
  return name;
}

export function validateDeclaredMime(value: string): string {
  const result = attachmentMimeTypeSchema.safeParse(value.toLowerCase().trim());
  if (!result.success) throw new ApplicationError("VALIDATION", "Invalid attachment MIME type.");
  return result.data;
}

/** Signatures classify bytes; they are not a malware scan or permission to execute. */
export function detectAttachmentMime(
  prefix: Uint8Array,
  declared: string,
): {
  detectedMimeType: string;
  mediaKind: Attachment["mediaKind"];
} {
  const starts = (...signature: number[]): boolean =>
    signature.every((byte, i) => prefix[i] === byte);
  let detectedMimeType = "application/octet-stream";
  let mediaKind: Attachment["mediaKind"] = "binary";
  if (starts(137, 80, 78, 71, 13, 10, 26, 10)) detectedMimeType = "image/png";
  else if (starts(255, 216, 255)) detectedMimeType = "image/jpeg";
  else if (starts(71, 73, 70, 56, 55, 97) || starts(71, 73, 70, 56, 57, 97))
    detectedMimeType = "image/gif";
  else if (
    prefix.length >= 12 &&
    prefix[4] === 102 &&
    prefix[5] === 116 &&
    prefix[6] === 121 &&
    prefix[7] === 112 &&
    ["isom", "iso2", "mp41", "mp42", "avc1", "M4V "].includes(
      String.fromCharCode(...prefix.slice(8, 12)),
    )
  )
    detectedMimeType = "video/mp4";
  if (detectedMimeType.startsWith("image/")) mediaKind = "image";
  if (detectedMimeType.startsWith("video/")) mediaKind = "video";
  if (
    declared !== "application/octet-stream" &&
    detectedMimeType !== "application/octet-stream" &&
    declared !== detectedMimeType
  ) {
    throw new ApplicationError("VALIDATION", "Declared MIME does not match attachment bytes.");
  }
  if (detectedMimeType === "application/octet-stream" && /^(image|video)\//.test(declared)) {
    throw new ApplicationError(
      "VALIDATION",
      "Unsupported or invalid media signature; use application/octet-stream for generic files.",
    );
  }
  return { detectedMimeType, mediaKind };
}

export function attachmentByteRange(
  value: string | undefined,
  size: number,
): ByteRange | undefined {
  if (value === undefined) return undefined;
  const match = /^bytes=(\d*)-(\d*)$/.exec(value);
  const invalid = (): never => {
    throw new ApplicationError("VALIDATION", "Requested range is not satisfiable.", {
      rangeSize: String(size),
    });
  };
  if (!match || (!match[1] && !match[2]) || size === 0) return invalid();
  const first = Number(match[1]);
  const last = Number(match[2]);
  if (!Number.isSafeInteger(first) || !Number.isSafeInteger(last)) return invalid();
  const start = match[1] ? first : Math.max(0, size - last);
  const end = match[1] && match[2] ? Math.min(last, size - 1) : size - 1;
  if (start > end || start >= size) return invalid();
  return { start, end };
}
