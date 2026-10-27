import { z } from "zod";
import { modelByteLimit } from "./presentation";

// Deliberately bounded static geometry subset. No loader plugins, URLs, textures, animation,
// shaders or executable extensions are interpreted. The renderer receives numbers only.
const index = z.int().nonnegative();
const vector3 = z.tuple([z.number().finite(), z.number().finite(), z.number().finite()]);
const modelSchema = z.object({
  asset: z.object({ version: z.literal("2.0") }),
  buffers: z.array(z.object({ byteLength: index, uri: z.string().optional() })).max(8),
  bufferViews: z
    .array(
      z.object({
        buffer: index,
        byteOffset: index.default(0),
        byteLength: index,
        byteStride: z.int().min(4).max(252).optional(),
      }),
    )
    .max(1024),
  accessors: z
    .array(
      z.object({
        bufferView: index,
        byteOffset: index.default(0),
        componentType: z.number(),
        count: index.max(60_000),
        type: z.enum(["SCALAR", "VEC2", "VEC3", "VEC4", "MAT2", "MAT3", "MAT4"]),
        sparse: z.never().optional(),
        normalized: z.literal(false).optional(),
      }),
    )
    .max(1024),
  meshes: z
    .array(
      z.object({
        primitives: z
          .array(
            z.object({
              attributes: z.object({ POSITION: index }),
              indices: index.optional(),
              mode: z.literal(4).optional(),
              targets: z.never().optional(),
            }),
          )
          .max(64),
      }),
    )
    .max(128),
  nodes: z
    .array(
      z.object({
        mesh: index.optional(),
        children: z.array(index).max(128).optional(),
        matrix: z.array(z.number().finite()).length(16).optional(),
        translation: vector3.optional(),
        rotation: z
          .tuple([
            z.number().finite(),
            z.number().finite(),
            z.number().finite(),
            z.number().finite(),
          ])
          .optional(),
        scale: vector3.optional(),
        skin: z.never().optional(),
      }),
    )
    .max(256),
  scenes: z
    .array(z.object({ nodes: z.array(index).max(256) }))
    .min(1)
    .max(32),
  scene: index.default(0),
  animations: z.array(z.unknown()).max(0).optional(),
});
type Model = z.infer<typeof modelSchema>;
type Point = [number, number, number];
export type ModelGeometry = { triangles: Float32Array; triangleCount: number };

function inspectTree(value: unknown, depth = 0): void {
  if (depth > 32) throw new Error("Model nesting exceeds preview budget.");
  if (typeof value !== "object" || value === null) return;
  for (const [key, child] of Object.entries(value)) {
    if (["extensions", "extensionsUsed", "extensionsRequired"].includes(key))
      throw new Error("Model extensions are unsupported.");
    if (
      key === "uri" &&
      (typeof child !== "string" ||
        !/^data:application\/(?:octet-stream|gltf-buffer);base64,[A-Za-z0-9+/]*={0,2}$/.test(child))
    )
      throw new Error("External model resources are unsupported.");
    inspectTree(child, depth + 1);
  }
}
function transform(point: Point, node: Model["nodes"][number]): Point {
  const [x, y, z] = point;
  if (node.matrix) {
    const m = node.matrix;
    return [
      (m[0] ?? 0) * x + (m[4] ?? 0) * y + (m[8] ?? 0) * z + (m[12] ?? 0),
      (m[1] ?? 0) * x + (m[5] ?? 0) * y + (m[9] ?? 0) * z + (m[13] ?? 0),
      (m[2] ?? 0) * x + (m[6] ?? 0) * y + (m[10] ?? 0) * z + (m[14] ?? 0),
    ];
  }
  const scale = node.scale ?? [1, 1, 1];
  const [qx, qy, qz, qw] = node.rotation ?? [0, 0, 0, 1];
  const sx = x * scale[0],
    sy = y * scale[1],
    sz = z * scale[2];
  const tx = 2 * (qy * sz - qz * sy),
    ty = 2 * (qz * sx - qx * sz),
    tz = 2 * (qx * sy - qy * sx);
  const t = node.translation ?? [0, 0, 0];
  return [
    sx + qw * tx + qy * tz - qz * ty + t[0],
    sy + qw * ty + qz * tx - qx * tz + t[1],
    sz + qw * tz + qx * ty - qy * tx + t[2],
  ];
}
export function parseModel(bytes: ArrayBuffer): ModelGeometry {
  if (bytes.byteLength > modelByteLimit || bytes.byteLength < 4)
    throw new Error("Model exceeds preview budget.");
  const view = new DataView(bytes);
  let jsonBytes: Uint8Array;
  let binary: Uint8Array | undefined;
  if (view.getUint32(0, true) === 0x46546c67) {
    if (
      bytes.byteLength < 20 ||
      view.getUint32(4, true) !== 2 ||
      view.getUint32(8, true) !== bytes.byteLength ||
      view.getUint32(16, true) !== 0x4e4f534a
    )
      throw new Error("Invalid GLB header.");
    const length = view.getUint32(12, true);
    if (length > 64 * 1024 || length % 4 || 20 + length > bytes.byteLength)
      throw new Error("Invalid GLB JSON.");
    jsonBytes = new Uint8Array(bytes, 20, length);
    const offset = 20 + length;
    if (offset < bytes.byteLength) {
      if (
        offset + 8 > bytes.byteLength ||
        view.getUint32(offset + 4, true) !== 0x004e4942 ||
        offset + 8 + view.getUint32(offset, true) !== bytes.byteLength
      )
        throw new Error("Invalid GLB binary chunk.");
      binary = new Uint8Array(bytes, offset + 8);
    }
  } else {
    if (bytes.byteLength > 64 * 1024) throw new Error("glTF JSON exceeds preview budget.");
    jsonBytes = new Uint8Array(bytes);
  }
  const raw: unknown = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(jsonBytes));
  inspectTree(raw);
  const model = modelSchema.parse(raw);
  let totalBufferBytes = 0;
  const buffers = model.buffers.map((buffer, position) => {
    const data = buffer.uri
      ? Uint8Array.from(atob(buffer.uri.split(",")[1] ?? ""), (c) => c.charCodeAt(0))
      : position === 0
        ? binary
        : undefined;
    if (!data || data.byteLength < buffer.byteLength || data.byteLength - buffer.byteLength > 3)
      throw new Error("Invalid model buffer.");
    totalBufferBytes += data.byteLength;
    if (totalBufferBytes > modelByteLimit) throw new Error("Model buffer budget exceeded.");
    return data;
  });
  function accessor(
    id: number,
    positions: boolean,
  ): { count: number; read: (element: number, component?: number) => number } {
    const a = model.accessors[id];
    if (
      !a ||
      a.type !== (positions ? "VEC3" : "SCALAR") ||
      (positions ? a.componentType !== 5126 : ![5121, 5123, 5125].includes(a.componentType))
    )
      throw new Error("Unsupported model accessor.");
    const b = model.bufferViews[a.bufferView];
    const data = b ? buffers[b.buffer] : undefined;
    if (!b || !data || b.byteOffset + b.byteLength > data.byteLength)
      throw new Error("Invalid model buffer view.");
    const size = a.componentType === 5121 ? 1 : a.componentType === 5123 ? 2 : 4;
    const elementSize = size * (positions ? 3 : 1);
    const stride = b.byteStride ?? elementSize;
    if (
      stride < elementSize ||
      stride % size ||
      a.byteOffset + Math.max(0, a.count - 1) * stride + elementSize > b.byteLength
    )
      throw new Error("Invalid model accessor bounds.");
    const reader = new DataView(data.buffer, data.byteOffset + b.byteOffset, b.byteLength);
    return {
      count: a.count,
      read(element, component = 0) {
        if (element < 0 || element >= a.count) throw new Error("Invalid mesh index.");
        const offset = a.byteOffset + element * stride + component * size;
        const value = positions
          ? reader.getFloat32(offset, true)
          : size === 1
            ? reader.getUint8(offset)
            : size === 2
              ? reader.getUint16(offset, true)
              : reader.getUint32(offset, true);
        if (!Number.isFinite(value) || Math.abs(value) > 1e12)
          throw new Error("Invalid mesh coordinate.");
        return value;
      },
    };
  }
  const triangles: number[] = [];
  let visits = 0;
  function visit(id: number, parents: Model["nodes"], path: Set<number>): void {
    const node = model.nodes[id];
    if (!node || path.has(id) || path.size > 32 || ++visits > 256)
      throw new Error("Invalid model scene graph.");
    const chain = [node, ...parents];
    if (node.mesh !== undefined) {
      const mesh = model.meshes[node.mesh];
      if (!mesh) throw new Error("Missing model mesh.");
      for (const primitive of mesh.primitives) {
        const positions = accessor(primitive.attributes.POSITION, true);
        const indices =
          primitive.indices === undefined ? undefined : accessor(primitive.indices, false);
        const count = indices?.count ?? positions.count;
        if (count % 3 || triangles.length / 3 + count > 60_000)
          throw new Error("Triangle budget exceeded.");
        for (let i = 0; i < count; i++) {
          const position = indices ? indices.read(i) : i;
          let point: Point = [
            positions.read(position, 0),
            positions.read(position, 1),
            positions.read(position, 2),
          ];
          for (const parent of chain) point = transform(point, parent);
          if (point.some((value) => !Number.isFinite(value) || Math.abs(value) > 1e12))
            throw new Error("Invalid model transform.");
          triangles.push(...point);
        }
      }
    }
    for (const child of node.children ?? []) visit(child, chain, new Set([...path, id]));
  }
  const scene = model.scenes[model.scene];
  if (!scene) throw new Error("Missing model scene.");
  for (const node of scene.nodes) visit(node, [], new Set());
  if (!triangles.length) throw new Error("No previewable triangles.");
  const minimum = [Infinity, Infinity, Infinity],
    maximum = [-Infinity, -Infinity, -Infinity];
  triangles.forEach((value, i) => {
    const axis = i % 3;
    minimum[axis] = Math.min(minimum[axis] ?? Infinity, value);
    maximum[axis] = Math.max(maximum[axis] ?? -Infinity, value);
  });
  const center = minimum.map((value, i) => (value + (maximum[i] ?? 0)) / 2);
  const span = Math.max(...minimum.map((value, i) => (maximum[i] ?? 0) - value));
  if (!span) throw new Error("Empty model bounds.");
  return {
    triangles: Float32Array.from(triangles, (value, i) => (value - (center[i % 3] ?? 0)) / span),
    triangleCount: triangles.length / 9,
  };
}
