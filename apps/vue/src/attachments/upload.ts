import { attachmentResponseSchema, type AttachmentResponse } from "@cce/api-contracts";
import { apiErrorResponseSchema } from "@cce/api-contracts";
import { ApiError, apiUrl, apiCredentials } from "../data/api-client";

export type UploadTarget = { projectId: string; conversationId: string };
export function validateFile(file: File): string | null {
  if (!file.size) return "Choose a non-empty file.";
  if (file.size > 100 * 1024 * 1024) return "Files must be 100 MiB or smaller.";
  const name = file.name
    .normalize("NFKC")
    .split(/[\\/]/)
    .at(-1)
    ?.replace(/[\p{Cc}\p{Cf}]/gu, "")
    .trim();
  if (!name || name === "." || name === ".." || name.length > 255) return "Invalid filename.";
  if (
    /(?:^|\.)(?:exe|com|bat|cmd|ps1|sh|js|mjs|cjs|html?|svg|scr|msi|dll|lnk|url|jar|vbs|hta)(?:\.|$)/i.test(
      name,
    )
  )
    return "Executable and active files cannot be uploaded.";
  return null;
}
export function uploadFile(
  target: UploadTarget,
  file: File,
  clientMessageId: string,
  signal: AbortSignal,
  progress: (percent: number) => void,
  resolveUrl: (path: string) => string = apiUrl,
): Promise<AttachmentResponse> {
  return new Promise((resolve, reject) => {
    signal.throwIfAborted();
    const invalid = validateFile(file);
    if (invalid) throw new Error(invalid);
    const xhr = new XMLHttpRequest();
    const path = resolveUrl(
      `/api/projects/${encodeURIComponent(target.projectId)}/conversations/${encodeURIComponent(target.conversationId)}/attachments`,
    );
    const abort = (): void => {
      xhr.abort();
      reject(new DOMException("Upload canceled.", "AbortError"));
    };
    const cleanup = (): void => signal.removeEventListener("abort", abort);
    xhr.open("POST", path);
    xhr.withCredentials = apiCredentials === "include";
    xhr.timeout = 120_000;
    xhr.setRequestHeader(
      "Content-Type",
      /^[a-z0-9!#$&^_.+-]+\/[a-z0-9!#$&^_.+-]+$/.test(file.type)
        ? file.type
        : "application/octet-stream",
    );
    xhr.setRequestHeader("X-CCE-Filename", encodeURIComponent(file.name));
    xhr.setRequestHeader("X-CCE-Client-Message-Id", clientMessageId);
    xhr.upload.onprogress = (event): void => {
      if (event.lengthComputable)
        progress(Math.min(100, Math.round((event.loaded / event.total) * 100)));
    };
    xhr.onload = (): void => {
      cleanup();
      try {
        signal.throwIfAborted();
        // A successful redirected response is not the upload contract.
        if (xhr.responseURL && xhr.responseURL !== new URL(path, location.origin).href)
          throw new Error("Unexpected upload redirect.");
        const payload: unknown = JSON.parse(xhr.responseText);
        if (xhr.status < 200 || xhr.status >= 300) {
          const error = apiErrorResponseSchema.safeParse(payload);
          throw new ApiError(
            xhr.status,
            error.success ? error.data.error.message : `Upload failed (HTTP ${xhr.status}).`,
          );
        }
        const attachment = attachmentResponseSchema.parse(payload);
        if (
          attachment.projectId !== target.projectId ||
          attachment.conversationId !== target.conversationId
        )
          throw new Error("Upload returned an unexpected attachment target.");
        resolve(attachment);
      } catch (error) {
        reject(
          xhr.status === 401
            ? new ApiError(401, "Session expired.")
            : error instanceof Error
              ? error
              : new Error("Invalid upload response."),
        );
      }
    };
    xhr.onerror = (): void => {
      cleanup();
      reject(new Error("Upload connection failed. Retry the same file."));
    };
    xhr.ontimeout = (): void => {
      cleanup();
      reject(new Error("Upload timed out. Retry the same file."));
    };
    xhr.onabort = (): void => {
      cleanup();
      reject(new DOMException("Upload canceled.", "AbortError"));
    };
    signal.addEventListener("abort", abort, { once: true });
    xhr.send(file);
  });
}
