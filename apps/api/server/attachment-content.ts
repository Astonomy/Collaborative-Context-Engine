import { ApplicationError, type AttachmentService } from "@cce/application";
import { errorResponse, TransportError } from "./request";

export async function* attachmentRequestBytes(request: Request): AsyncIterable<Uint8Array> {
  if (request.body === null) throw new TransportError("Attachment body is required.");
  const reader = request.body.getReader();
  try {
    while (true) {
      const result = await reader.read();
      if (result.done) break;
      yield result.value;
    }
  } finally {
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}

export function attachmentContentResponse(
  result: Awaited<ReturnType<AttachmentService["download"]>>,
): Response {
  const { attachment, range } = result;
  const inlineMedia = ["image/png", "image/jpeg", "image/gif", "video/mp4"].includes(
    attachment.detectedMimeType,
  );
  const iterator = result.bytes[Symbol.asyncIterator]();
  const stream = new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const next = await iterator.next();
        if (next.done) controller.close();
        else controller.enqueue(next.value);
      } catch {
        await iterator.return?.().catch(() => undefined);
        controller.error(
          new ApplicationError("DEPENDENCY_UNAVAILABLE", "Attachment stream is unavailable."),
        );
      }
    },
    async cancel() {
      await iterator.return?.();
    },
  });
  // Only signature-validated passive media receives its MIME type.
  return new Response(stream, {
    status: range ? 206 : 200,
    headers: {
      "content-type": inlineMedia ? attachment.detectedMimeType : "application/octet-stream",
      "content-disposition": `${inlineMedia ? "inline" : "attachment"}; filename="attachment"; filename*=UTF-8''${encodeURIComponent(attachment.originalFilename).replace(/['()*]/g, (c) => `%${c.charCodeAt(0).toString(16)}`)}`,
      "content-length": String(range ? range.end - range.start + 1 : attachment.byteSize),
      "accept-ranges": "bytes",
      "cache-control": "private, no-store",
      "x-content-type-options": "nosniff",
      "content-security-policy": "default-src 'none'; sandbox",
      ...(range
        ? { "content-range": `bytes ${range.start}-${range.end}/${attachment.byteSize}` }
        : {}),
    },
  });
}

export function attachmentRangeError(error: unknown, requestId: string): Response {
  if (!(error instanceof ApplicationError) || error.details["rangeSize"] === undefined) throw error;
  const response = errorResponse(error, requestId);
  return new Response(response.body, {
    status: 416,
    headers: {
      ...Object.fromEntries(response.headers),
      "content-range": `bytes */${error.details["rangeSize"]}`,
      "accept-ranges": "bytes",
    },
  });
}
