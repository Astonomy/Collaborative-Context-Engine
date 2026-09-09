import { z } from "zod";

export const externalSourceSchema = z.enum(["chatgpt", "chatgpt-plugin", "codex-plugin"]);
export type ExternalConversationSource = z.infer<typeof externalSourceSchema>;

export const externalMetadataSchema = z.record(z.string(), z.json());
export const externalContentBlockSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("text"), text: z.string() }).strict(),
  z
    .object({
      type: z.literal("file_reference"),
      reference: z.string(),
      metadata: externalMetadataSchema,
    })
    .strict(),
  z
    .object({
      type: z.literal("image_reference"),
      reference: z.string(),
      metadata: externalMetadataSchema,
    })
    .strict(),
  z.object({ type: z.literal("tool_call"), metadata: externalMetadataSchema }).strict(),
  z.object({ type: z.literal("tool_result"), metadata: externalMetadataSchema }).strict(),
  z
    .object({
      type: z.literal("unknown"),
      providerType: z.string(),
      metadata: externalMetadataSchema,
    })
    .strict(),
]);
export type ExternalContentBlock = z.infer<typeof externalContentBlockSchema>;

export const externalMessageNodeSchema = z
  .object({
    externalMessageId: z.string().min(1).max(500).optional(),
    parentExternalMessageId: z.string().min(1).max(500).optional(),
    role: z.enum(["user", "assistant", "system", "tool", "unknown"]),
    content: z.array(externalContentBlockSchema),
    createdAt: z.string().datetime().optional(),
    metadata: externalMetadataSchema,
  })
  .strict();
export type ExternalMessageNode = z.infer<typeof externalMessageNodeSchema>;

export const externalConversationSchema = z
  .object({
    source: externalSourceSchema,
    externalConversationId: z.string().min(1).max(500).optional(),
    title: z.string().min(1).max(200).optional(),
    createdAt: z.string().datetime().optional(),
    updatedAt: z.string().datetime().optional(),
    currentExternalMessageId: z.string().min(1).max(500).optional(),
    nodes: z.array(externalMessageNodeSchema),
    metadata: externalMetadataSchema,
    warnings: z.array(z.string().max(500)),
  })
  .strict();
export type ExternalConversation = z.infer<typeof externalConversationSchema>;

export interface ImportInput {
  readonly fileName: string;
  readonly bytes: Uint8Array;
}
export interface DetectionResult {
  readonly detected: boolean;
  readonly format?: "json" | "zip";
  readonly confidence: "none" | "high";
}
export interface ImportValidationResult {
  readonly valid: boolean;
  readonly warnings: readonly string[];
}
export interface ConversationImporter {
  readonly source: ExternalConversationSource;
  detect(input: ImportInput): Promise<DetectionResult>;
  parse(input: ImportInput): Promise<ExternalConversation[]>;
  validate(conversations: readonly ExternalConversation[]): Promise<ImportValidationResult>;
}

export interface ImportLimits {
  readonly maximumUploadBytes: number;
  readonly maximumExpandedBytes: number;
  readonly maximumFiles: number;
  readonly maximumConversations: number;
  readonly maximumMessagesPerConversation: number;
  readonly maximumMessageBytes: number;
}

export const defaultImportLimits: ImportLimits = {
  maximumUploadBytes: 8 * 1024 * 1024,
  maximumExpandedBytes: 32 * 1024 * 1024,
  maximumFiles: 100,
  maximumConversations: 2_000,
  maximumMessagesPerConversation: 20_000,
  maximumMessageBytes: 1_000_000,
};

export class ConversationImportError extends Error {
  public constructor(
    public readonly code: "UNSUPPORTED" | "MALFORMED" | "LIMIT_EXCEEDED",
    message: string,
  ) {
    super(message);
    this.name = "ConversationImportError";
  }
}
