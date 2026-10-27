import { importAttachmentSchema, type AttachmentRepository } from "@cce/application";
import { attachmentSchema, attachmentEventSchema, type Attachment } from "@cce/domain";
import { and, asc, eq } from "drizzle-orm";
import { z } from "zod";
import { attachments, attachmentEvents, importAttachmentUploads } from "./attachment-schema";
import { parsePersisted, type DatabaseSession } from "./repositories";

const evidenceSchema = attachmentSchema.omit({
  id: true,
  projectId: true,
  conversationId: true,
  messageId: true,
  ordinal: true,
  storage: true,
});
const detailSchema = attachmentEventSchema.omit({
  id: true,
  projectId: true,
  attachmentId: true,
  sequence: true,
});

function fromRow(row: typeof attachments.$inferSelect): Attachment {
  const { evidence, storageProvider, storageKey, storageVersion, ...identity } = row;
  return parsePersisted(
    attachmentSchema,
    {
      ...identity,
      ...parsePersisted(evidenceSchema, evidence, "attachment evidence"),
      storage: { provider: storageProvider, key: storageKey, version: storageVersion },
    },
    "attachment",
  );
}

export function createAttachmentRepository(session: DatabaseSession): AttachmentRepository {
  return {
    async insertImportUpload(input) {
      const { projectId, id, actorUserId, uploadId, ...detail } =
        importAttachmentSchema.parse(input);
      await session
        .insert(importAttachmentUploads)
        .values({ projectId, id, actorUserId, uploadId, detail });
    },
    async findImportUpload(projectId, id) {
      const rows = await session
        .select()
        .from(importAttachmentUploads)
        .where(
          and(eq(importAttachmentUploads.projectId, projectId), eq(importAttachmentUploads.id, id)),
        );
      const row = rows[0];
      if (!row) return null;
      const { detail, ...identity } = row;
      return parsePersisted(
        importAttachmentSchema,
        { ...z.record(z.string(), z.unknown()).parse(detail), ...identity },
        "import attachment upload",
      );
    },
    async findImportUploadByRequest(projectId, actorUserId, uploadId) {
      const rows = await session
        .select()
        .from(importAttachmentUploads)
        .where(
          and(
            eq(importAttachmentUploads.projectId, projectId),
            eq(importAttachmentUploads.actorUserId, actorUserId),
            eq(importAttachmentUploads.uploadId, uploadId),
          ),
        );
      const row = rows[0];
      if (!row) return null;
      const { detail, ...identity } = row;
      return parsePersisted(
        importAttachmentSchema,
        { ...z.record(z.string(), z.unknown()).parse(detail), ...identity },
        "import attachment upload",
      );
    },
    async insert(input) {
      const { id, projectId, conversationId, messageId, ordinal, storage, ...evidence } =
        attachmentSchema.parse(input);
      await session.insert(attachments).values({
        id,
        projectId,
        conversationId,
        messageId,
        ordinal,
        storageProvider: storage.provider,
        storageKey: storage.key,
        storageVersion: storage.version,
        evidence,
      });
    },
    async find(projectId, attachmentId) {
      z.uuid().parse(projectId);
      z.uuid().parse(attachmentId);
      const rows = await session
        .select()
        .from(attachments)
        .where(and(eq(attachments.projectId, projectId), eq(attachments.id, attachmentId)));
      return rows[0] === undefined ? null : fromRow(rows[0]);
    },
    async listForMessage(projectId, messageId) {
      z.uuid().parse(projectId);
      z.uuid().parse(messageId);
      const rows = await session
        .select()
        .from(attachments)
        .where(and(eq(attachments.projectId, projectId), eq(attachments.messageId, messageId)))
        .orderBy(asc(attachments.ordinal));
      return rows.map(fromRow);
    },
    async listForConversation(projectId, conversationId) {
      z.uuid().parse(projectId);
      z.uuid().parse(conversationId);
      const rows = await session
        .select()
        .from(attachments)
        .where(
          and(eq(attachments.projectId, projectId), eq(attachments.conversationId, conversationId)),
        )
        .orderBy(asc(attachments.messageId), asc(attachments.ordinal));
      return rows.map(fromRow);
    },
    async appendEvent(input) {
      const { id, projectId, attachmentId, sequence, ...detail } =
        attachmentEventSchema.parse(input);
      await session
        .insert(attachmentEvents)
        .values({ id, projectId, attachmentId, sequence, detail });
    },
    async listEvents(projectId, attachmentId) {
      z.uuid().parse(projectId);
      z.uuid().parse(attachmentId);
      const rows = await session
        .select()
        .from(attachmentEvents)
        .where(
          and(
            eq(attachmentEvents.projectId, projectId),
            eq(attachmentEvents.attachmentId, attachmentId),
          ),
        )
        .orderBy(asc(attachmentEvents.sequence));
      return rows.map(({ detail, ...identity }) =>
        parsePersisted(
          attachmentEventSchema,
          { ...identity, ...parsePersisted(detailSchema, detail, "attachment event detail") },
          "attachment event",
        ),
      );
    },
  };
}
