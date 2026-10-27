import { projectIdSchema } from "@cce/domain";
import { z } from "zod";
import {
  apiRoute,
  authenticateRequest,
  jsonSuccess,
  TransportError,
} from "../../../../../server/request";
import { attachmentRequestBytes } from "../../../../../server/attachment-content";
import type { HttpServices } from "../../../../../server/services";
const responseSchema = z.object({
  attachmentId: z.uuid(),
  filename: z.string(),
  byteSize: z.int().positive(),
  checksum: z.string(),
  expiresAt: z.string().datetime(),
});
export function createHandlers(getRuntime: () => HttpServices): {
  POST: (request: Request, context: { params: { projectId: string } }) => Promise<Response>;
} {
  return {
    POST(request: Request, context: { params: { projectId: string } }): Promise<Response> {
      return apiRoute(async () => {
        const runtime = getRuntime();
        const actor = await authenticateRequest(request, runtime);
        const projectId = projectIdSchema.parse(context.params.projectId);
        let filename: string;
        try {
          filename = decodeURIComponent(request.headers.get("x-cce-filename") ?? "");
        } catch {
          throw new TransportError("Invalid encoded filename.");
        }
        const upload = await runtime.attachments.uploadForImport(
          {
            projectId,
            actorUserId: actor.id,
            uploadId: request.headers.get("x-cce-upload-id") ?? "",
            filename,
            declaredMimeType: request.headers.get("content-type") ?? "application/octet-stream",
          },
          attachmentRequestBytes(request),
        );
        return jsonSuccess(
          responseSchema,
          {
            attachmentId: upload.id,
            filename: upload.originalFilename,
            byteSize: upload.byteSize,
            checksum: upload.checksum.value,
            expiresAt: upload.expiresAt,
          },
          201,
        );
      });
    },
  };
}
