import type {
  Attachment,
  AttachmentEvent,
  AttachmentId,
  ProjectId,
  MessageId,
  ConversationId,
} from "@cce/domain";

import type { ImportAttachment } from "./import-attachment";
import type { UserId } from "@cce/domain";

/** Internal transaction port. Callers must authorize project access before use. */
export interface AttachmentRepository {
  insertImportUpload(upload: ImportAttachment): Promise<void>;
  findImportUpload(
    projectId: ProjectId,
    attachmentId: AttachmentId,
  ): Promise<ImportAttachment | null>;
  findImportUploadByRequest(
    projectId: ProjectId,
    actorUserId: UserId,
    uploadId: string,
  ): Promise<ImportAttachment | null>;
  /** Insert before the new Message in the same transaction. */
  insert(attachment: Attachment): Promise<void>;
  find(projectId: ProjectId, attachmentId: AttachmentId): Promise<Attachment | null>;
  listForMessage(projectId: ProjectId, messageId: MessageId): Promise<readonly Attachment[]>;
  listForConversation(
    projectId: ProjectId,
    conversationId: ConversationId,
  ): Promise<readonly Attachment[]>;
  appendEvent(event: AttachmentEvent): Promise<void>;
  listEvents(projectId: ProjectId, attachmentId: AttachmentId): Promise<readonly AttachmentEvent[]>;
}
