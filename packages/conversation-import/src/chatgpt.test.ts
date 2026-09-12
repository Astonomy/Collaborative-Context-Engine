import { describe, expect, it } from "vitest";
import { ChatGptExportImporter, ConversationImportError, selectCurrentPath } from "./index";

const encoder = new TextEncoder();
const conversation = {
  id: "c1",
  title: "Imported chat",
  create_time: 1_700_000_000,
  current_node: "a1",
  mapping: {
    root: { id: "root", parent: null, message: null, children: ["u1"] },
    u1: {
      id: "u1",
      parent: "root",
      children: ["a1"],
      message: {
        id: "u1",
        author: { role: "human" },
        create_time: 1_700_000_001,
        content: { content_type: "text", parts: ["hello"] },
      },
    },
    a1: {
      id: "a1",
      parent: "u1",
      children: [],
      message: {
        id: "a1",
        author: { role: "assistant" },
        content: { content_type: "text", parts: ["hi"] },
      },
    },
  },
};
const input = (value: unknown) => ({
  fileName: "conversations.json",
  bytes: encoder.encode(JSON.stringify(value)),
});

describe("ChatGptExportImporter", () => {
  it("parses a provider-neutral current path", async () => {
    const parsed = await new ChatGptExportImporter().parse(input([conversation]));
    expect(parsed).toHaveLength(1);
    const first = parsed[0];
    if (first === undefined) throw new Error("Expected one parsed conversation.");
    expect(selectCurrentPath(first).map((n) => n.role)).toEqual(["user", "assistant"]);
  });
  it("accepts a conversations JSON wrapper", async () =>
    expect(
      await new ChatGptExportImporter().parse(input({ conversations: [conversation] })),
    ).toHaveLength(1));
  it("rejects ZIP uploads", async () => {
    const bytes = new Uint8Array([0x50, 0x4b, 0x03, 0x04]);
    await expect(
      new ChatGptExportImporter().parse({ fileName: "export.zip", bytes }),
    ).rejects.toMatchObject({ code: "UNSUPPORTED" });
  });
  it("reports branches, unknown roles, unsupported content and missing parents", async () => {
    const changed: Record<string, unknown> = structuredClone(conversation);
    const mapping = changed["mapping"] as Record<string, typeof conversation.mapping.a1>;
    const assistant = mapping["a1"];
    const user = mapping["u1"];
    if (assistant === undefined || user === undefined) throw new Error("Invalid test fixture.");
    assistant.message.author.role = "critic";
    assistant.message.content = { content_type: "audio", parts: [] };
    assistant.parent = "missing";
    mapping["alt"] = { ...assistant, id: "alt" };
    const children: string[] = user.children;
    children.push("alt");
    const [parsed] = await new ChatGptExportImporter().parse(input([changed]));
    if (parsed === undefined) throw new Error("Expected one parsed conversation.");
    expect(parsed.warnings.join(" ")).toMatch(
      /Unknown role|unsupported content|missing parent|branch point/,
    );
  });
  it.each([
    ["malformed", encoder.encode("{")],
    ["shape", encoder.encode("{}")],
  ])("rejects invalid %s JSON", async (_name, bytes) =>
    expect(new ChatGptExportImporter().parse({ fileName: "x.json", bytes })).rejects.toBeInstanceOf(
      ConversationImportError,
    ),
  );
  it("does not detect arbitrary binary input", async () => {
    await expect(
      new ChatGptExportImporter().detect({ fileName: "notes.bin", bytes: new Uint8Array([1, 2]) }),
    ).resolves.toEqual({ detected: false, confidence: "none" });
  });

  it("accepts an empty export", async () => {
    await expect(new ChatGptExportImporter().parse(input([]))).resolves.toEqual([]);
  });

  it.each(["image_asset_pointer", "file"])(
    "preserves %s references with warnings",
    async (contentType) => {
      const changed = structuredClone(conversation);
      changed.mapping.a1.message.content = {
        content_type: contentType,
        parts: [],
      };
      Object.assign(changed.mapping.a1.message.content, {
        asset_pointer: "asset://safe-reference",
      });
      const [parsed] = await new ChatGptExportImporter().parse(input([changed]));
      expect(parsed?.nodes.at(-1)?.content[0]).toMatchObject({
        reference: "asset://safe-reference",
      });
      expect(parsed?.warnings).not.toHaveLength(0);
    },
  );
  it("enforces upload and message limits", async () => {
    await expect(
      new ChatGptExportImporter({
        ...{
          maximumUploadBytes: 1,
          maximumConversations: 1,
          maximumMessagesPerConversation: 1,
          maximumMessageBytes: 1,
        },
      }).parse(input([conversation])),
    ).rejects.toMatchObject({ code: "LIMIT_EXCEEDED" });
  });
  it("detects duplicate conversation and message ids", async () => {
    const duplicate = structuredClone(conversation);
    duplicate.mapping.a1.message.id = "u1";
    const parsed = await new ChatGptExportImporter().parse(input([duplicate, duplicate]));
    const validation = await new ChatGptExportImporter().validate(parsed);
    expect(validation.warnings.join(" ")).toMatch(/Duplicate conversation id|Duplicate message id/);
  });
  it("rejects cycles when selecting a path", async () => {
    const [parsed] = await new ChatGptExportImporter().parse(input([conversation]));
    const firstNode = parsed?.nodes[0];
    if (parsed === undefined || firstNode === undefined) {
      throw new Error("Expected a parsed conversation with one node.");
    }
    firstNode.parentExternalMessageId = "a1";
    expect(() => selectCurrentPath(parsed)).toThrow(/cycle/);
  });
});
