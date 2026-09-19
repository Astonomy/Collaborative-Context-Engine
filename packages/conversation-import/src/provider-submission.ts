import { z } from "zod";

import {
  ConversationImportError,
  externalContentBlockSchema,
  externalConversationSchema,
  externalMetadataSchema,
  type ExternalConversation,
} from "./types";

export const providerSubmissionLimits = {
  maximumPayloadBytes: 8 * 1_024 * 1_024,
  maximumMessages: 2_000,
  maximumContentBlocksPerMessage: 100,
  maximumMessageBytes: 1_000_000,
  maximumMetadataBytes: 64 * 1_024,
} as const;

const providerContentBlockSchema = externalContentBlockSchema;

export const providerConversationSubmissionSchema = z
  .object({
    source: z.enum(["chatgpt", "codex"]),
    captureScope: z.enum(["full", "partial"]),
    previousImportId: z.uuid().optional(),
    externalConversationId: z.string().trim().min(1).max(500).optional(),
    title: z.string().trim().min(1).max(200).optional(),
    summary: z.string().trim().min(1).max(8_000).optional(),
    createdAt: z.string().datetime().optional(),
    messages: z
      .array(
        z
          .object({
            externalMessageId: z.string().trim().min(1).max(500).optional(),
            role: z.enum(["user", "assistant", "system", "tool", "unknown"]),
            content: z
              .array(providerContentBlockSchema)
              .min(1)
              .max(providerSubmissionLimits.maximumContentBlocksPerMessage),
            createdAt: z.string().datetime().optional(),
            metadata: externalMetadataSchema.default({}),
          })
          .strict(),
      )
      .min(1)
      .max(providerSubmissionLimits.maximumMessages),
    metadata: externalMetadataSchema.default({}),
  })
  .strict();

export type ProviderConversationSubmission = z.infer<typeof providerConversationSubmissionSchema>;

export interface NormalizedProviderSubmission {
  readonly conversation: ExternalConversation;
  readonly messageCount: number;
  readonly unsupportedContentCount: number;
  readonly warnings: readonly string[];
  readonly normalizedJson: string;
}

export function normalizeProviderSubmission(input: unknown): NormalizedProviderSubmission {
  const parsed = parseSubmission(input);
  const normalizedJson = canonicalJson(parsed);
  if (Buffer.byteLength(normalizedJson, "utf8") > providerSubmissionLimits.maximumPayloadBytes) {
    throw new ConversationImportError(
      "LIMIT_EXCEEDED",
      "Conversation submission exceeds the allowed total size.",
    );
  }
  assertMetadataSize(parsed);

  const warnings: string[] = [];
  let unsupportedContentCount = 0;
  if (parsed.captureScope === "partial") {
    warnings.push(
      "This is a partial user-authorized capture, not a complete provider conversation export.",
    );
  }

  const nodes = parsed.messages.map((message) => {
    const textBytes = message.content
      .filter((block): block is Extract<typeof block, { type: "text" }> => block.type === "text")
      .reduce((total, block) => total + Buffer.byteLength(block.text, "utf8"), 0);
    if (textBytes > providerSubmissionLimits.maximumMessageBytes) {
      throw new ConversationImportError(
        "LIMIT_EXCEEDED",
        `A submitted message exceeds the ${providerSubmissionLimits.maximumMessageBytes} byte limit.`,
      );
    }
    const references = message.content.filter(
      (block) => block.type === "file_reference" || block.type === "image_reference",
    ).length;
    const unsupported = message.content.filter((block) => block.type !== "text").length;
    unsupportedContentCount += unsupported;
    if (references > 0) {
      warnings.push(
        `A ${message.role} message contains ${references} original material reference(s); CCE retains them unchanged in the import manifest, while only text becomes CCE Message evidence.`,
      );
    }
    const otherUnsupported = unsupported - references;
    if (otherUnsupported > 0) {
      warnings.push(
        `A ${message.role} message contains ${otherUnsupported} unsupported non-reference content block(s); only text becomes CCE Message evidence.`,
      );
    }
    if (message.role === "unknown") {
      warnings.push(
        "A message with an unknown role will be retained in provenance but not persisted as CCE Message evidence.",
      );
    }
    return {
      ...(message.externalMessageId ? { externalMessageId: message.externalMessageId } : {}),
      role: message.role,
      content: message.content,
      ...(message.createdAt ? { createdAt: message.createdAt } : {}),
      metadata: message.metadata,
    };
  });

  const messageCount = nodes.filter(
    (node) =>
      node.role !== "unknown" &&
      node.content.some((block) => block.type === "text" && block.text.trim().length > 0),
  ).length;
  if (messageCount === 0) {
    throw new ConversationImportError(
      "MALFORMED",
      "Conversation submission contains no supported non-empty message text.",
    );
  }

  const conversation = externalConversationSchema.parse({
    source: parsed.source === "chatgpt" ? "chatgpt-plugin" : "codex-plugin",
    ...(parsed.previousImportId ? { previousImportId: parsed.previousImportId } : {}),
    ...(parsed.externalConversationId
      ? { externalConversationId: parsed.externalConversationId }
      : {}),
    ...(parsed.title ? { title: parsed.title } : {}),
    ...(parsed.summary ? { summary: parsed.summary } : {}),
    ...(parsed.createdAt ? { createdAt: parsed.createdAt } : {}),
    nodes,
    metadata: {
      ...parsed.metadata,
      captureScope: parsed.captureScope,
      submittedMessageCount: parsed.messages.length,
    },
    warnings,
  });
  return { conversation, messageCount, unsupportedContentCount, warnings, normalizedJson };
}

function parseSubmission(input: unknown): ProviderConversationSubmission {
  try {
    return providerConversationSubmissionSchema.parse(input);
  } catch (error: unknown) {
    if (error instanceof z.ZodError) {
      throw new ConversationImportError("MALFORMED", "Conversation submission is malformed.");
    }
    throw error;
  }
}

function assertMetadataSize(input: ProviderConversationSubmission): void {
  const metadataValues = [input.metadata, ...input.messages.map((message) => message.metadata)];
  for (const message of input.messages) {
    for (const block of message.content) {
      if ("metadata" in block) metadataValues.push(block.metadata);
    }
  }
  const bytes = Buffer.byteLength(canonicalJson(metadataValues), "utf8");
  if (bytes > providerSubmissionLimits.maximumMetadataBytes) {
    throw new ConversationImportError(
      "LIMIT_EXCEEDED",
      "Conversation submission metadata exceeds the allowed size.",
    );
  }
}

function canonicalJson(value: unknown): string {
  return JSON.stringify(canonicalValue(value));
}

function canonicalValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Readonly<Record<string, unknown>>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, canonicalValue(item)]),
    );
  }
  return value;
}
