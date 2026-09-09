import {
  externalConversationSchema,
  ConversationImportError,
  defaultImportLimits,
  type ConversationImporter,
  type DetectionResult,
  type ExternalConversation,
  type ExternalContentBlock,
  type ImportInput,
  type ImportLimits,
  type ImportValidationResult,
  type ExternalMessageNode,
} from "./types";
import { readBoundedZip } from "./zip";

type JsonObject = Record<string, unknown>;
const isObject = (v: unknown): v is JsonObject =>
  typeof v === "object" && v !== null && !Array.isArray(v);
const string = (v: unknown): string | undefined =>
  typeof v === "string" && v.length > 0 ? v : undefined;
const instant = (v: unknown): string | undefined =>
  typeof v === "number" && Number.isFinite(v)
    ? new Date(v * 1000).toISOString()
    : typeof v === "string" && !Number.isNaN(Date.parse(v))
      ? new Date(v).toISOString()
      : undefined;

export class ChatGptExportImporter implements ConversationImporter {
  public readonly source = "chatgpt" as const;
  public constructor(private readonly limits: ImportLimits = defaultImportLimits) {}
  public async detect(input: ImportInput): Promise<DetectionResult> {
    await Promise.resolve();
    const zip = input.bytes[0] === 0x50 && input.bytes[1] === 0x4b;
    const json =
      input.fileName.toLowerCase().endsWith(".json") ||
      [0x5b, 0x7b].includes(input.bytes.find((b) => b > 0x20) ?? -1);
    return zip
      ? { detected: true, format: "zip" as const, confidence: "high" as const }
      : json
        ? { detected: true, format: "json" as const, confidence: "high" as const }
        : { detected: false, confidence: "none" as const };
  }
  public async parse(input: ImportInput): Promise<ExternalConversation[]> {
    if (input.bytes.byteLength > this.limits.maximumUploadBytes)
      throw new ConversationImportError("LIMIT_EXCEEDED", "Upload exceeds the allowed size.");
    const detected = await this.detect(input);
    if (!detected.detected)
      throw new ConversationImportError(
        "UNSUPPORTED",
        "Input is not a supported ChatGPT JSON or ZIP export.",
      );
    const documents =
      detected.format === "zip"
        ? [...readBoundedZip(input.bytes, this.limits)].filter(([name]) =>
            /(^|\/)conversations(?:-\d+)?\.json$/i.test(name),
          )
        : [[input.fileName, input.bytes] as const];
    if (documents.length === 0)
      throw new ConversationImportError(
        "UNSUPPORTED",
        "Archive contains no conversations JSON file.",
      );
    const result: ExternalConversation[] = [];
    for (const [, bytes] of documents) {
      let value: unknown;
      try {
        value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
      } catch {
        throw new ConversationImportError(
          "MALFORMED",
          "Conversation JSON is malformed or not UTF-8.",
        );
      }
      const rows = Array.isArray(value)
        ? value
        : isObject(value) && Array.isArray(value["conversations"])
          ? value["conversations"]
          : null;
      if (rows === null)
        throw new ConversationImportError(
          "UNSUPPORTED",
          "Conversation JSON has an unsupported top-level shape.",
        );
      for (const row of rows) {
        if (result.length >= this.limits.maximumConversations)
          throw new ConversationImportError(
            "LIMIT_EXCEEDED",
            "Export contains too many conversations.",
          );
        result.push(this.parseConversation(row));
      }
    }
    return result;
  }
  public async validate(
    conversations: readonly ExternalConversation[],
  ): Promise<ImportValidationResult> {
    await Promise.resolve();
    const ids = new Set<string>(),
      warnings: string[] = [];
    for (const c of conversations) {
      externalConversationSchema.parse(c);
      if (c.externalConversationId && ids.has(c.externalConversationId))
        warnings.push(`Duplicate conversation id: ${c.externalConversationId}`);
      if (c.externalConversationId) ids.add(c.externalConversationId);
      warnings.push(...c.warnings);
    }
    return { valid: true, warnings };
  }
  private parseConversation(value: unknown): ExternalConversation {
    if (!isObject(value) || !isObject(value["mapping"]))
      throw new ConversationImportError(
        "UNSUPPORTED",
        "ChatGPT conversation is missing its mapping graph.",
      );
    const warnings: string[] = [],
      nodes = [];
    const ids = new Set<string>();
    for (const [key, rawNode] of Object.entries(value["mapping"])) {
      if (nodes.length >= this.limits.maximumMessagesPerConversation)
        throw new ConversationImportError(
          "LIMIT_EXCEEDED",
          "Conversation contains too many messages.",
        );
      if (!isObject(rawNode)) {
        warnings.push(`Invalid mapping node ${key} was ignored.`);
        continue;
      }
      const message = rawNode["message"];
      if (!isObject(message)) continue;
      const id = string(message["id"]) ?? key;
      if (ids.has(id)) warnings.push(`Duplicate message id: ${id}`);
      ids.add(id);
      const author = isObject(message["author"]) ? message["author"] : {};
      const rawRole = string(author["role"]) ?? "unknown";
      const role =
        rawRole === "human" || rawRole === "user"
          ? "user"
          : ["assistant", "system", "tool"].includes(rawRole)
            ? (rawRole as "assistant" | "system" | "tool")
            : "unknown";
      if (role === "unknown") warnings.push(`Unknown role '${rawRole}' on message ${id}.`);
      const blocks = this.contentBlocks(message["content"], id, warnings);
      const textBytes = blocks
        .filter((b): b is Extract<ExternalContentBlock, { type: "text" }> => b.type === "text")
        .reduce((n, b) => n + Buffer.byteLength(b.text), 0);
      if (textBytes > this.limits.maximumMessageBytes)
        throw new ConversationImportError(
          "LIMIT_EXCEEDED",
          `Message ${id} exceeds the allowed size.`,
        );
      const parentExternalMessageId = string(rawNode["parent"]);
      const createdAt = instant(message["create_time"]);
      nodes.push({
        externalMessageId: id,
        ...(parentExternalMessageId ? { parentExternalMessageId } : {}),
        role,
        content: blocks,
        ...(createdAt ? { createdAt } : {}),
        metadata: {
          providerContentType: isObject(message["content"])
            ? (string(message["content"]["content_type"]) ?? "unknown")
            : "unknown",
        },
      });
    }
    const known = new Set(nodes.map((n) => n.externalMessageId));
    for (const n of nodes)
      if (n.parentExternalMessageId && !known.has(n.parentExternalMessageId))
        warnings.push(
          `Message ${n.externalMessageId} references missing parent ${n.parentExternalMessageId}.`,
        );
    const children = new Map<string, number>();
    for (const n of nodes)
      if (n.parentExternalMessageId)
        children.set(n.parentExternalMessageId, (children.get(n.parentExternalMessageId) ?? 0) + 1);
    const branches = [...children.values()].filter((n) => n > 1).length;
    if (branches > 0)
      warnings.push(
        `Source graph contains ${branches} branch point(s); only the current path will become CCE evidence.`,
      );
    const title = string(value["title"]);
    return externalConversationSchema.parse({
      source: "chatgpt",
      ...(string(value["id"]) ? { externalConversationId: string(value["id"]) } : {}),
      ...(title ? { title: title.slice(0, 200) } : {}),
      ...(instant(value["create_time"]) ? { createdAt: instant(value["create_time"]) } : {}),
      ...(instant(value["update_time"]) ? { updatedAt: instant(value["update_time"]) } : {}),
      ...(string(value["current_node"])
        ? { currentExternalMessageId: string(value["current_node"]) }
        : {}),
      nodes,
      metadata: { branchPointCount: branches },
      warnings,
    });
  }
  private contentBlocks(value: unknown, id: string, warnings: string[]): ExternalContentBlock[] {
    if (!isObject(value)) {
      warnings.push(`Message ${id} has invalid content.`);
      return [{ type: "unknown", providerType: "invalid", metadata: {} }];
    }
    const type = string(value["content_type"]) ?? "unknown";
    if (type === "text" && Array.isArray(value["parts"]))
      return value["parts"].map((p) =>
        typeof p === "string"
          ? { type: "text" as const, text: p }
          : {
              type: "unknown" as const,
              providerType: "text_part",
              metadata: { valueType: typeof p },
            },
      );
    if (type.includes("image")) {
      warnings.push(`Message ${id} contains an image reference.`);
      return [
        {
          type: "image_reference",
          reference: string(value["asset_pointer"]) ?? "unavailable",
          metadata: { contentType: type },
        },
      ];
    }
    if (type.includes("file")) {
      warnings.push(`Message ${id} contains a file reference.`);
      return [
        {
          type: "file_reference",
          reference: string(value["asset_pointer"]) ?? "unavailable",
          metadata: { contentType: type },
        },
      ];
    }
    if (type.includes("tool")) {
      warnings.push(`Message ${id} contains structured tool content.`);
      return [
        {
          type: type.includes("result") ? "tool_result" : "tool_call",
          metadata: { contentType: type },
        },
      ];
    }
    warnings.push(`Message ${id} uses unsupported content type '${type}'.`);
    return [{ type: "unknown", providerType: type, metadata: {} }];
  }
}

export function selectCurrentPath(conversation: ExternalConversation): ExternalMessageNode[] {
  const byId = new Map(
    conversation.nodes.flatMap((node) =>
      node.externalMessageId === undefined ? [] : [[node.externalMessageId, node] as const],
    ),
  );
  let id = conversation.currentExternalMessageId;
  const path = [],
    seen = new Set<string>();
  if (!id) {
    const parents = new Set(
      conversation.nodes.map((n) => n.parentExternalMessageId).filter(Boolean),
    );
    id = [...byId.keys()].find((key) => !parents.has(key));
  }
  while (id) {
    if (seen.has(id))
      throw new ConversationImportError("MALFORMED", "Conversation mapping contains a cycle.");
    seen.add(id);
    const node = byId.get(id);
    if (!node) break;
    path.push(node);
    id = node.parentExternalMessageId;
  }
  return path.reverse();
}
