import { describe, expect, it } from "vitest";
import { HeaderMediaInspector } from "./media-inspector.server";

const inspector = new HeaderMediaInspector();
function inspect(b: Buffer, filename = "asset.bin", byteSize = b.length) {
  return inspector.inspect(b, { filename, byteSize });
}
describe("bounded media headers", () => {
  it("compares signatures byte-for-byte without stripping high bits", () => {
    const gif = Buffer.alloc(13);
    gif.write("GIF89a");
    gif[0] = 0xc7;
    gif.writeUInt16LE(12, 6);
    gif.writeUInt16LE(24, 8);
    expect(inspect(gif).mimeValidation).toBe("unknown");
    const mp4 = Buffer.alloc(16);
    mp4.writeUInt32BE(16);
    mp4.write("ftypisom", 4);
    mp4[4] = 0xe6;
    expect(inspect(mp4).mimeValidation).toBe("unknown");
  });
  it("reads PNG and GIF dimensions without decoding", () => {
    const png = Buffer.alloc(33);
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).copy(png);
    png.writeUInt32BE(13, 8);
    png.write("IHDR", 12);
    png.writeUInt32BE(320, 16);
    png.writeUInt32BE(200, 20);
    expect(inspect(png)).toMatchObject({
      mimeType: "image/png",
      metadata: { width: 320, height: 200 },
      preview: "image-original",
    });
    png.writeUInt32BE(100000, 16);
    expect(() => inspect(png)).toThrow();
    expect(() => inspect(png.subarray(0, 8))).toThrow();
    const gif = Buffer.alloc(13);
    gif.write("GIF89a");
    gif.writeUInt16LE(12, 6);
    gif.writeUInt16LE(24, 8);
    expect(inspect(gif).metadata).toEqual({ width: 12, height: 24 });
    expect(() => inspect(gif.subarray(0, 6))).toThrow();
  });
  it("reads JPEG frame segments and rejects truncation and zero segment length", () => {
    const jpeg = Buffer.from([255, 216, 255, 224, 0, 2, 255, 192, 0, 8, 8, 0, 20, 0, 30, 1]);
    expect(inspect(jpeg).metadata).toEqual({ width: 30, height: 20 });
    for (const b of [
      jpeg.subarray(0, 8),
      Buffer.from([255, 216, 255, 224, 0, 0]),
      Buffer.from([255, 216, 0, 0, 0, 0]),
    ])
      expect(() => inspect(b)).toThrow();
  });
  it("identifies MP4 while leaving unsupported duration/dimensions absent", () => {
    const b = Buffer.alloc(16);
    b.writeUInt32BE(16);
    b.write("ftypisom", 4);
    expect(inspect(b)).toMatchObject({
      mimeType: "video/mp4",
      metadata: { format: "mp4" },
      poster: "client-frame",
    });
    b.write("avif", 8);
    expect(inspect(b).preview).toBe("download");
    b.writeUInt32BE(100);
    expect(() => inspect(b)).toThrow();
  });
  it("identifies glTF/GLB without traversing URIs or exposing arbitrary JSON", () => {
    const json = Buffer.from(
      '{"asset":{"version":"2.0"},"buffers":[{"uri":"https://private/secret"}]}',
    );
    expect(inspect(json, "scene.gltf")).toMatchObject({
      metadata: { format: "gltf-2" },
      preview: "3d-isolated",
    });
    const padded = Buffer.from(json.toString().padEnd(Math.ceil(json.length / 4) * 4));
    const glb = Buffer.alloc(20 + padded.length);
    glb.write("glTF");
    glb.writeUInt32LE(2, 4);
    glb.writeUInt32LE(glb.length, 8);
    glb.writeUInt32LE(padded.length, 12);
    glb.writeUInt32LE(0x4e4f534a, 16);
    padded.copy(glb, 20);
    expect(inspect(glb).metadata.format).toBe("glb-2");
    expect(inspect(glb.subarray(0, 24), "scene.glb", glb.length).preview).toBe("download");
    glb.writeUInt32LE(1, 4);
    expect(() => inspect(glb)).toThrow();
    for (const text of ["{}", "{", '{"asset":null}', "[".repeat(33), '{"asset":{"version":"1.0"}}'])
      expect(inspect(Buffer.from(text), "bad.gltf").preview).toBe("download");
  });
  it.each(["onnx", "safetensors", "pt", "pth", "pkl"])(
    "never interprets %s models",
    (extension) => {
      expect(
        inspect(Buffer.from('{"asset":{"version":"2.0"}}'), `model.${extension}`),
      ).toMatchObject({
        mimeValidation: "unknown",
        metadata: { format: `unverified-${extension}` },
        preview: "download",
      });
    },
  );
  it("bounds resources and defaults unknown binaries to download", () => {
    expect(() => inspect(Buffer.alloc(65537))).toThrow();
    expect(() => inspect(Buffer.alloc(2), "x", 1)).toThrow();
    expect(inspect(Buffer.from("anything"))).toMatchObject({
      mimeType: "application/octet-stream",
      preview: "download",
    });
  });
});
