import { mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, expect, it, vi } from "vitest";
import * as filesystem from "node:fs/promises";
vi.mock("node:fs/promises", async (importOriginal) => ({
  ...(await importOriginal<typeof filesystem>()),
}));
import { LocalAttachmentStorage } from "./local-attachment-storage";

const directories: string[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  for (const path of directories.splice(0)) await rm(path, { recursive: true, force: true });
});
it("closes on the final byte even when an HTTP consumer does not request another chunk", async () => {
  const { storage } = await fixture();
  const object = await storage.put(content());
  const opened = vi.spyOn(filesystem, "open");
  const iterator = (await storage.open(object.storage, 3))[Symbol.asyncIterator]();
  const result = opened.mock.results[0];
  if (!result || result.type !== "return") throw new Error("No opened file");
  const file = await result.value;
  const close = vi.spyOn(file, "close");
  expect((await iterator.next()).value).toEqual(new Uint8Array([1, 2, 3]));
  expect(close).toHaveBeenCalledOnce();
  await iterator.return?.();
  expect(close).toHaveBeenCalledOnce();
});
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "cce-storage-"));
  directories.push(root);
  return { root, storage: new LocalAttachmentStorage(root) };
}
async function* content() {
  yield new Uint8Array([1, 2, 3]);
}
it("reads large objects lazily in bounded chunks and stops I/O on cancellation", async () => {
  const { root, storage } = await fixture();
  const key = "00000000-0000-4000-8000-000000000001";
  const size = 32 * 1024 * 1024;
  const file = await filesystem.open(join(root, key), "wx");
  await file.truncate(size);
  await file.close();
  const opened = vi.spyOn(filesystem, "open");
  const iterator = (await storage.open({ provider: "local", version: "1", key }, size))[
    Symbol.asyncIterator
  ]();
  const result = opened.mock.results[0];
  if (!result || result.type !== "return") throw new Error("No opened file");
  const handle = await result.value;
  const read = vi.spyOn(handle, "read");
  const close = vi.spyOn(handle, "close");
  expect(read).not.toHaveBeenCalled();
  const first = await iterator.next();
  if (first.done) throw new Error("Stream ended before its first chunk");
  expect(first.value.byteLength).toBe(64 * 1024);
  expect(read).toHaveBeenCalledOnce();
  await iterator.return?.();
  expect(close).toHaveBeenCalledOnce();
  expect((await iterator.next()).done).toBe(true);
  expect(read).toHaveBeenCalledOnce();
});
it("uses exclusive identities even for identical bytes", async () => {
  const { storage } = await fixture();
  const a = await storage.put(content());
  const b = await storage.put(content());
  expect(a.checksum).toEqual(b.checksum);
  expect(a.storage).not.toEqual(b.storage);
});
it("rejects traversal, foreign providers and versions", async () => {
  const { storage } = await fixture();
  const a = await storage.put(content());
  for (const change of [
    { key: "../secret" },
    { key: "C:/secret" },
    { provider: "s3" },
    { version: "2" },
  ]) {
    await expect(storage.open({ ...a.storage, ...change }, 3)).rejects.toThrow(
      "Invalid local attachment identity",
    );
  }
});
it("closes an opened object when cancelled before or during reading", async () => {
  const { root, storage } = await fixture();
  const a = await storage.put(content());
  const first = (await storage.open(a.storage, 3))[Symbol.asyncIterator]();
  await first.return?.();
  expect((await first.next()).done).toBe(true);
  const second = (await storage.open(a.storage, 3))[Symbol.asyncIterator]();
  expect((await second.next()).value).toEqual(new Uint8Array([1, 2, 3]));
  await second.return?.();
  expect((await second.next()).done).toBe(true);
  await writeFile(join(root, a.storage.key), new Uint8Array([1]));
  await expect(storage.open(a.storage, 3)).rejects.toThrow("size mismatch");
});
it("removes interrupted partial uploads", async () => {
  const { root, storage } = await fixture();
  async function* interrupted() {
    yield new Uint8Array([1, 2]);
    throw new Error("cancelled");
  }
  await expect(storage.put(interrupted())).rejects.toThrow("cancelled");
  expect(await readdir(root)).toEqual([]);
});
