import { expect, it } from "vitest";
import { parseModel } from "./model-geometry";
import { glbFixture, gltfFixture } from "./fixtures";
function encode(value: unknown): ArrayBuffer {
  return new TextEncoder().encode(JSON.stringify(value)).buffer;
}
it("previews representative self-contained glTF and GLB geometry", () => {
  for (const bytes of [encode(gltfFixture()), glbFixture()]) {
    const parsed = parseModel(bytes);
    expect(parsed.triangleCount).toBe(1);
    expect([...parsed.triangles]).toEqual([-0.5, -0.5, 0, 0.5, -0.5, 0, 0, 0.5, 0]);
  }
});
it.each([
  { buffers: [{ byteLength: 36, uri: "https://attacker.test/mesh.bin" }] },
  { buffers: [{ byteLength: 36, uri: "data:text/html;base64,AAAA" }] },
  { extensionsUsed: ["custom-script"] },
  { nodes: [{ mesh: 0, children: [0] }] },
  { nodes: [{ mesh: 0, skin: 0 }] },
  { animations: [{}] },
  { accessors: [{ bufferView: 0, componentType: 5126, count: 60001, type: "VEC3" }] },
  { accessors: [{ bufferView: 0, componentType: 5126, count: 3, type: "VEC3", sparse: {} }] },
  { bufferViews: [{ buffer: 0, byteLength: 4 }] },
  { meshes: [{ primitives: [{ attributes: { POSITION: 0 }, mode: 1 }] }] },
])("rejects unsupported or unsafe geometry %j", (change) => {
  expect(() => parseModel(encode({ ...gltfFixture(), ...change }))).toThrow();
});
it("bounds scene instances, depth, malformed bytes and coordinate values", () => {
  expect(() => parseModel(new ArrayBuffer(9 * 1024 * 1024))).toThrow();
  expect(() => parseModel(glbFixture().slice(0, 24))).toThrow();
  expect(() =>
    parseModel(encode({ ...gltfFixture(), nodes: [{ mesh: 0, scale: [1e30, 1, 1] }] })),
  ).toThrow();
  const nodes = Array.from({ length: 40 }, (_, i) => ({
    mesh: 0,
    children: i === 39 ? [] : [i + 1],
  }));
  expect(() => parseModel(encode({ ...gltfFixture(), nodes }))).toThrow();
});

it.each([5121, 5123, 5125])("reads indexed triangles with component type %i", (componentType) => {
  const indices =
    componentType === 5121
      ? new Uint8Array([0, 1, 2])
      : componentType === 5123
        ? new Uint16Array([0, 1, 2])
        : new Uint32Array([0, 1, 2]);
  const positions = new Float32Array([-1, -1, 0, 1, -1, 0, 0, 1, 0]);
  const bytes = new Uint8Array(36 + indices.byteLength);
  bytes.set(new Uint8Array(positions.buffer));
  bytes.set(new Uint8Array(indices.buffer), 36);
  const model = {
    ...gltfFixture(),
    buffers: [
      {
        byteLength: bytes.length,
        uri: "data:application/octet-stream;base64," + btoa(String.fromCharCode(...bytes)),
      },
    ],
    bufferViews: [
      { buffer: 0, byteLength: 36 },
      { buffer: 0, byteOffset: 36, byteLength: indices.byteLength },
    ],
    accessors: [
      { bufferView: 0, componentType: 5126, count: 3, type: "VEC3" },
      { bufferView: 1, componentType, count: 3, type: "SCALAR" },
    ],
    meshes: [{ primitives: [{ attributes: { POSITION: 0 }, indices: 1 }] }],
    nodes: [
      { children: [1], translation: [1, 2, 3] },
      { mesh: 0, matrix: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 4, 5, 6, 1] },
    ],
  };
  expect([...parseModel(encode(model)).triangles]).toEqual([
    -0.5, -0.5, 0, 0.5, -0.5, 0, 0, 0.5, 0,
  ]);
  bytes[36] = 9;
  model.buffers = [
    {
      byteLength: bytes.length,
      uri: "data:application/octet-stream;base64," + btoa(String.fromCharCode(...bytes)),
    },
  ];
  expect(() => parseModel(encode(model))).toThrow("mesh index");
});

it.each([
  { nodes: [{ mesh: 9 }] },
  { scenes: [{ nodes: [99] }] },
  { scene: 9 },
  { nodes: [{}] },
  { nodes: [{ mesh: 0, scale: [0, 0, 0] }] },
  { buffers: [{ byteLength: 36 }] },
  { bufferViews: [{ buffer: 9, byteLength: 36 }] },
  { bufferViews: [{ buffer: 0, byteOffset: 36, byteLength: 36 }] },
  { bufferViews: [{ buffer: 0, byteStride: 5, byteLength: 36 }] },
  { accessors: [{ bufferView: 9, componentType: 5126, count: 3, type: "VEC3" }] },
  { accessors: [{ bufferView: 0, componentType: 5123, count: 3, type: "VEC3" }] },
  { accessors: [{ bufferView: 0, componentType: 5126, count: 2, type: "VEC3" }] },
  { meshes: [{ primitives: [{ attributes: { POSITION: 9 } }] }] },
])("rejects invalid scene and buffer references %j", (change) => {
  expect(() => parseModel(encode({ ...gltfFixture(), ...change }))).toThrow();
});
it("rejects invalid GLB chunks and oversized JSON before parsing", () => {
  for (const [offset, value] of [
    [4, 1],
    [12, 65540],
    [12, 3],
    [16, 0],
    [12, 65532],
  ]) {
    const bytes = glbFixture();
    if (offset === undefined || value === undefined) throw new Error("Missing fixture mutation");
    new DataView(bytes).setUint32(offset, value, true);
    expect(() => parseModel(bytes)).toThrow();
  }
  const bytes = glbFixture();
  const view = new DataView(bytes);
  view.setUint32(24 + view.getUint32(12, true), 0, true);
  expect(() => parseModel(bytes)).toThrow("binary chunk");
  expect(() => parseModel(new ArrayBuffer(65537))).toThrow("JSON exceeds");
});
