import { Buffer } from "node:buffer";
import type { MediaDescription, MediaInspector } from "@cce/application";

const generic = (): MediaDescription => ({
  mimeType: "application/octet-stream",
  mimeValidation: "unknown",
  metadata: {},
  preview: "download",
  thumbnail: "unavailable",
  poster: "unavailable",
});

/** Bounded structural header reader. No codecs, decompression, model runtime or external I/O. */
export class HeaderMediaInspector implements MediaInspector {
  public inspect(
    prefix: Uint8Array,
    source: { filename: string; byteSize: number },
  ): MediaDescription {
    if (prefix.length > 65_536 || prefix.length > source.byteSize)
      throw new Error("Invalid prefix");
    const b = Buffer.from(prefix.buffer, prefix.byteOffset, prefix.byteLength);
    const result = generic();
    const extension = source.filename.toLowerCase().split(".").at(-1);
    // Filename classification only: never deserialize pickle, protobuf or tensor archives.
    if (["onnx", "safetensors", "pt", "pth", "pkl", "pickle"].includes(extension ?? "")) {
      result.metadata.format = `unverified-${extension}`;
      return result;
    }
    const image = (mime: string, width: number, height: number): MediaDescription => {
      if (
        width < 1 ||
        height < 1 ||
        width > 16_384 ||
        height > 16_384 ||
        width * height > 40_000_000
      )
        throw new Error("Image dimensions exceed budget");
      return {
        ...result,
        mimeType: mime,
        mimeValidation: "header",
        metadata: { width, height },
        preview: "image-original",
      };
    };
    if (b.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) {
      if (b.length < 33 || b.readUInt32BE(8) !== 13 || b.toString("latin1", 12, 16) !== "IHDR")
        throw new Error("Invalid PNG");
      return image("image/png", b.readUInt32BE(16), b.readUInt32BE(20));
    }
    if (["GIF87a", "GIF89a"].includes(b.toString("latin1", 0, 6))) {
      if (b.length < 13) throw new Error("Invalid GIF");
      return image("image/gif", b.readUInt16LE(6), b.readUInt16LE(8));
    }
    if (b[0] === 255 && b[1] === 216) {
      let offset = 2;
      while (offset + 4 <= b.length) {
        if (b[offset] !== 255) throw new Error("Invalid JPEG marker");
        const marker = b[offset + 1];
        if (marker === 255) {
          offset++;
          continue;
        }
        const length = b.readUInt16BE(offset + 2);
        if (length < 2 || offset + 2 + length > b.length) throw new Error("Incomplete JPEG header");
        if (marker !== undefined && [192, 193, 194].includes(marker)) {
          if (length < 8) throw new Error("Invalid JPEG frame");
          return image("image/jpeg", b.readUInt16BE(offset + 7), b.readUInt16BE(offset + 5));
        }
        offset += 2 + length;
      }
      throw new Error("JPEG dimensions unavailable");
    }
    if (b.toString("latin1", 4, 8) === "ftyp") {
      const length = b.readUInt32BE(0);
      if (length < 16 || length > b.length || length % 4 !== 0)
        throw new Error("Invalid MP4 header");
      if (!["isom", "iso2", "mp41", "mp42", "avc1", "M4V "].includes(b.toString("latin1", 8, 12)))
        return result;
      return {
        ...result,
        mimeType: "video/mp4",
        mimeValidation: "header",
        metadata: { format: "mp4" },
        preview: "video-stream",
        poster: "client-frame",
      };
    }
    if (b.toString("latin1", 0, 4) === "glTF") {
      if (
        b.length < 20 ||
        b.readUInt32LE(4) !== 2 ||
        b.readUInt32LE(8) !== source.byteSize ||
        b.readUInt32LE(16) !== 0x4e4f534a
      )
        throw new Error("Invalid GLB header");
      const jsonLength = b.readUInt32LE(12);
      if (jsonLength % 4 !== 0 || jsonLength + 20 > b.length) return result;
      if (!validGltf(b.toString("utf8", 20, 20 + jsonLength)))
        throw new Error("Invalid GLB metadata");
      return {
        ...result,
        mimeType: "model/gltf-binary",
        mimeValidation: "header",
        metadata: { format: "glb-2" },
        preview: "3d-isolated",
      };
    }
    if (extension === "gltf" && source.byteSize === b.length && validGltf(b.toString("utf8"))) {
      return {
        ...result,
        mimeType: "model/gltf+json",
        mimeValidation: "header",
        metadata: { format: "gltf-2" },
        preview: "3d-isolated",
      };
    }
    return result;
  }
}

function validGltf(text: string): boolean {
  // Bound JSON nesting before parsing. Ignore braces in escaped JSON strings.
  let depth = 0;
  let quoted = false;
  let escaped = false;
  for (const c of text) {
    if (quoted) {
      if (escaped) escaped = false;
      else if (c === "\\") escaped = true;
      else if (c === '"') quoted = false;
    } else if (c === '"') quoted = true;
    else if (c === "{" || c === "[") {
      if (++depth > 32) return false;
    } else if (c === "}" || c === "]") depth--;
  }
  try {
    const value: unknown = JSON.parse(text);
    if (typeof value !== "object" || value === null || !("asset" in value)) return false;
    const asset = value.asset;
    return (
      typeof asset === "object" && asset !== null && "version" in asset && asset.version === "2.0"
    );
  } catch {
    return false;
  }
}
