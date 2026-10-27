import type { AttachmentService } from "./attachment-service";
import { ApplicationError } from "./errors";
import {
  mediaDescriptionSchema,
  mediaPrefixBytes,
  type MediaInspection,
  type MediaInspector,
} from "./media-inspection";

/** Read-only derived view, not a persisted processing job or mutation of source evidence. */
export class MediaProcessingService {
  private active = 0;
  public constructor(
    private readonly attachments: Pick<AttachmentService, "get" | "download">,
    private readonly inspector: MediaInspector,
  ) {}

  public async inspect(input: Parameters<AttachmentService["get"]>[0]): Promise<MediaInspection> {
    const attachment = await this.attachments.get(input);
    const fallback: MediaInspection = {
      status: "failed",
      error: "inspection-failed",
      filename: attachment.originalFilename,
      byteSize: attachment.byteSize,
      downloadable: true,
      description: {
        mimeType: "application/octet-stream",
        mimeValidation: "unknown",
        metadata: {},
        preview: "download",
        thumbnail: "unavailable",
        poster: "unavailable",
      },
    };
    if (this.active >= 4) return { ...fallback, error: "busy" };
    this.active++;
    let expired = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const work = async (): Promise<MediaInspection> => {
      try {
        const size = Math.min(attachment.byteSize, mediaPrefixBytes);
        if (size === 0) return fallback;
        const { bytes } = await this.attachments.download({
          ...input,
          range: `bytes=0-${size - 1}`,
        });
        const prefix = new Uint8Array(size);
        let offset = 0;
        let chunks = 0;
        for await (const chunk of bytes) {
          if (expired) break;
          if (++chunks > mediaPrefixBytes || offset + chunk.length > size) return fallback;
          prefix.set(chunk, offset);
          offset += chunk.length;
        }
        if (expired || offset !== size) return fallback;
        const description = mediaDescriptionSchema.parse(
          this.inspector.inspect(prefix, {
            filename: attachment.originalFilename,
            byteSize: attachment.byteSize,
          }),
        );
        return { ...fallback, status: "succeeded", error: null, description };
      } catch (error) {
        if (
          error instanceof ApplicationError &&
          ["NOT_FOUND", "FORBIDDEN", "CONFLICT"].includes(error.code)
        )
          throw error;
        return fallback;
      } finally {
        this.active--;
      }
    };
    try {
      return await Promise.race([
        work(),
        new Promise<MediaInspection>((resolve) => {
          timer = setTimeout(() => {
            expired = true;
            resolve({ ...fallback, error: "timeout" });
          }, 2_000);
        }),
      ]);
    } finally {
      clearTimeout(timer);
    }
  }
}
