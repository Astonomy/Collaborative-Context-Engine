import { deflateRawSync } from "node:zlib";
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

function zip(name: string, data: Uint8Array): Uint8Array {
  const body = deflateRawSync(data),
    n = encoder.encode(name),
    b = new Uint8Array(30 + n.length + body.length);
  const v = new DataView(b.buffer);
  v.setUint32(0, 0x04034b50, true);
  v.setUint16(8, 8, true);
  v.setUint32(18, body.length, true);
  v.setUint32(22, data.length, true);
  v.setUint16(26, n.length, true);
  b.set(n, 30);
  b.set(body, 30 + n.length);
  return b;
}

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
  it("parses bounded ZIP exports", async () =>
    expect(
      await new ChatGptExportImporter().parse({
        fileName: "export.zip",
        bytes: zip("conversations.json", input([conversation]).bytes),
      }),
    ).toHaveLength(1));
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
  it("rejects unsafe ZIP paths", async () =>
    expect(
      new ChatGptExportImporter().parse({
        fileName: "x.zip",
        bytes: zip("../conversations.json", input([]).bytes),
      }),
    ).rejects.toMatchObject({ code: "MALFORMED" }));
  it("enforces upload and message limits", async () => {
    await expect(
      new ChatGptExportImporter({
        ...{
          maximumUploadBytes: 1,
          maximumExpandedBytes: 10,
          maximumFiles: 1,
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
