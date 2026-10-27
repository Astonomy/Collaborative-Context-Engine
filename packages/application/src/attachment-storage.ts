import type { Attachment } from "@cce/domain";

export interface ByteRange {
  readonly start: number;
  readonly end: number;
}

/** Internal immutable object identity; never accepted from a client. */
export interface AttachmentStorage {
  /** Generate an exclusive identity, stream bytes, compute SHA-256. Remove partial writes on failure. */
  put(bytes: AsyncIterable<Uint8Array>): Promise<{
    readonly storage: Attachment["storage"];
    readonly checksum: Attachment["checksum"];
    readonly byteSize: number;
  }>;
  /** Open before returning, verify size, close on completion/cancellation. */
  open(
    storage: Attachment["storage"],
    expectedSize: number,
    range?: ByteRange,
  ): Promise<AsyncIterable<Uint8Array>>;
}
