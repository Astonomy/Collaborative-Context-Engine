import type { AttachmentResponse } from "@cce/api-contracts";
import { readBrowserConfig } from "../config";
export function previewPath(attachment: AttachmentResponse): string {
  const { base } = readBrowserConfig({ VITE_APP_BASE: import.meta.env["VITE_APP_BASE"] });
  return (
    base +
    "projects/" +
    encodeURIComponent(attachment.projectId) +
    "/attachments/" +
    encodeURIComponent(attachment.id)
  );
}
