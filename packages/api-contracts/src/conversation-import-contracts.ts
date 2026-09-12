import { projectIdSchema } from "@cce/domain";
import { providerConversationSubmissionSchema } from "@cce/conversation-import";
import { z } from "zod";
export const conversationImportPathSchema = z
  .object({ projectId: projectIdSchema, importId: z.uuid() })
  .strict();
export const providerConversationImportPreviewPathSchema = z
  .object({ projectId: projectIdSchema, previewId: z.uuid() })
  .strict();
export const conversationImportUploadBodySchema = z
  .object({
    source: z.literal("chatgpt"),
    fileName: z
      .string()
      .trim()
      .min(1)
      .max(255)
      .regex(/\.json$/i, "Only JSON files are supported."),
    dataBase64: z.string().min(1).max(12_000_000),
  })
  .strict();
export const confirmConversationImportBodySchema = conversationImportUploadBodySchema
  .extend({ selectedConversationIds: z.array(z.string().min(1).max(500)).min(1).max(2_000) })
  .strict();
const previewItem = z
  .object({
    selectionId: z.string(),
    title: z.string(),
    approximateDate: z.string().datetime().optional(),
    messageCount: z.int().nonnegative(),
    branchCount: z.int().nonnegative(),
    warnings: z.array(z.string()),
  })
  .strict();
export const conversationImportPreviewResponseSchema = z
  .object({
    source: z.literal("chatgpt"),
    sourceFormat: z.literal("json"),
    sourceFileHash: z.string(),
    duplicateImportId: z.uuid().optional(),
    conversations: z.array(previewItem),
  })
  .strict();
export const providerConversationImportPreviewBodySchema = providerConversationSubmissionSchema;
export const providerConversationImportSubmitBodySchema = z
  .object({ previewId: z.uuid() })
  .strict();
export const providerConversationImportPreviewResponseSchema = z
  .object({
    id: z.uuid(),
    source: z.enum(["chatgpt-plugin", "codex-plugin"]),
    targetProject: z
      .object({ id: projectIdSchema, name: z.string().trim().min(1).max(160) })
      .strict(),
    title: z.string().trim().min(1).max(200),
    summary: z.string().trim().min(1).max(8_000).optional(),
    messageCount: z.int().positive(),
    unsupportedContentCount: z.int().nonnegative(),
    warnings: z.array(z.string().max(500)),
    duplicateStatus: z.enum(["none", "duplicate"]),
    duplicateImportId: z.uuid().optional(),
    duplicateConversationId: z.uuid().optional(),
    expiresAt: z.string().datetime(),
  })
  .strict();
export const conversationImportResponseSchema = z
  .object({
    id: z.uuid(),
    projectId: projectIdSchema,
    source: z.enum(["chatgpt", "chatgpt-plugin", "codex-plugin"]),
    sourceFormat: z.enum(["json", "zip", "mcp"]),
    sourceFileHash: z.string(),
    policy: z.enum(["current_path", "provided_messages"]),
    status: z.literal("completed"),
    createdBy: z.uuid(),
    createdAt: z.string().datetime(),
    completedAt: z.string().datetime(),
    conversationCount: z.int(),
    messageCount: z.int(),
    warnings: z.array(z.string()),
    sourceManifest: z.array(z.unknown()),
    importedConversations: z.array(
      z
        .object({
          externalConversationId: z.string().optional(),
          conversationId: z.uuid(),
          messageIds: z.array(z.uuid()),
        })
        .strict(),
    ),
  })
  .strict();
