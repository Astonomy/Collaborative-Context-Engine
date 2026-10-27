import { sql } from "drizzle-orm";
import {
  pgTable,
  uuid,
  integer,
  text,
  jsonb,
  primaryKey,
  unique,
  foreignKey,
  check,
  index,
} from "drizzle-orm/pg-core";
import { messages, projects, users } from "./schema";
export const importAttachmentUploads = pgTable(
  "import_attachment_uploads",
  {
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.projectId),
    id: uuid("id").notNull(),
    actorUserId: uuid("actor_user_id")
      .notNull()
      .references(() => users.id),
    uploadId: uuid("upload_id").notNull(),
    detail: jsonb("detail").$type<unknown>().notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.projectId, table.id] }),
    unique().on(table.projectId, table.actorUserId, table.uploadId),
  ],
);

export const attachments = pgTable(
  "attachments",
  {
    projectId: uuid("project_id").notNull(),
    id: uuid("id").notNull(),
    conversationId: uuid("conversation_id").notNull(),
    messageId: uuid("message_id").notNull(),
    ordinal: integer("ordinal").notNull(),
    storageProvider: text("storage_provider").notNull(),
    storageKey: text("storage_key").notNull(),
    storageVersion: text("storage_version").notNull(),
    evidence: jsonb("evidence").$type<unknown>().notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.projectId, table.id] }),
    unique("attachments_message_ordinal_uq").on(table.projectId, table.messageId, table.ordinal),
    unique("attachments_storage_uq").on(
      table.storageProvider,
      table.storageKey,
      table.storageVersion,
    ),
    foreignKey({
      columns: [table.projectId, table.conversationId, table.messageId],
      foreignColumns: [messages.projectId, messages.conversationId, messages.id],
      name: "attachments_message_fk",
    }).onDelete("restrict"),
    index("attachments_conversation_idx").on(table.projectId, table.conversationId),
    check("attachments_ordinal_check", sql`${table.ordinal} BETWEEN 0 AND 1023`),
  ],
);

export const attachmentEvents = pgTable(
  "attachment_events",
  {
    projectId: uuid("project_id").notNull(),
    id: uuid("id").notNull(),
    attachmentId: uuid("attachment_id").notNull(),
    sequence: integer("sequence").notNull(),
    detail: jsonb("detail").$type<unknown>().notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.projectId, table.id] }),
    unique("attachment_events_sequence_uq").on(table.projectId, table.attachmentId, table.sequence),
    foreignKey({
      columns: [table.projectId, table.attachmentId],
      foreignColumns: [attachments.projectId, attachments.id],
    }).onDelete("restrict"),
    check("attachment_events_sequence_check", sql`${table.sequence} > 0`),
  ],
);
