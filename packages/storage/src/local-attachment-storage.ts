import { createHash, randomUUID } from "node:crypto";
import { mkdir, open, unlink } from "node:fs/promises";
import { resolve, join } from "node:path";
import {
  ApplicationError,
  maximumAttachmentBytes,
  type AttachmentStorage,
  type ByteRange,
} from "@cce/application";
import type { Attachment } from "@cce/domain";

/** Private, service-owned directory outside the public/web roots. No caller-chosen paths. */
export class LocalAttachmentStorage implements AttachmentStorage {
  private readonly root: string;
  public constructor(root: string) {
    if (!root.trim()) throw new Error("Attachment storage directory is required.");
    this.root = resolve(root);
  }

  public async put(bytes: AsyncIterable<Uint8Array>): ReturnType<AttachmentStorage["put"]> {
    await mkdir(this.root, { recursive: true, mode: 0o700 });
    const storage = { provider: "local", key: randomUUID(), version: "1" };
    const path = this.path(storage);
    const file = await open(path, "wx", 0o600);
    let byteSize = 0;
    const hash = createHash("sha256");
    try {
      for await (const chunk of bytes) {
        byteSize += chunk.byteLength;
        if (byteSize > maximumAttachmentBytes)
          throw new ApplicationError("VALIDATION", "Attachment exceeds the 100 MiB limit.");
        hash.update(chunk);
        let offset = 0;
        while (offset < chunk.length) {
          const result = await file.write(chunk, offset, chunk.length - offset);
          if (result.bytesWritten === 0) throw new Error("Attachment write failed.");
          offset += result.bytesWritten;
        }
      }
      await file.sync();
      await file.close();
      return { storage, byteSize, checksum: { algorithm: "sha256", value: hash.digest("hex") } };
    } catch (error) {
      await file.close().catch(() => undefined);
      await unlink(path).catch(() => undefined);
      throw error;
    }
  }

  public async open(
    storage: Attachment["storage"],
    expectedSize: number,
    range?: ByteRange,
  ): Promise<AsyncIterable<Uint8Array>> {
    const file = await open(this.path(storage), "r");
    try {
      const stat = await file.stat();
      if (!stat.isFile() || stat.size !== expectedSize)
        throw new Error("Attachment size mismatch.");
    } catch (error) {
      await file.close();
      throw error;
    }
    let position = range?.start ?? 0;
    const end = range?.end ?? expectedSize - 1;
    let closed = false;
    const close = async (): Promise<void> => {
      if (!closed) {
        closed = true;
        await file.close();
      }
    };
    const iterator: AsyncIterableIterator<Uint8Array> = {
      [Symbol.asyncIterator]() {
        return this;
      },
      async next() {
        if (closed || position > end) {
          await close();
          return { done: true, value: undefined };
        }
        try {
          const buffer = new Uint8Array(Math.min(64 * 1024, end - position + 1));
          const { bytesRead } = await file.read(buffer, 0, buffer.length, position);
          if (bytesRead === 0) throw new Error("Attachment truncated.");
          position += bytesRead;
          if (position > end) await close();
          return { done: false, value: buffer.subarray(0, bytesRead) };
        } catch (error) {
          await close();
          throw error;
        }
      },
      async return() {
        await close();
        return { done: true, value: undefined };
      },
    };
    return iterator;
  }

  private path(storage: Attachment["storage"]): string {
    if (
      storage.provider !== "local" ||
      storage.version !== "1" ||
      !/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(storage.key)
    ) {
      throw new Error("Invalid local attachment identity.");
    }
    return join(this.root, storage.key);
  }
}
