import { describe, expect, it } from "vitest";

import { normalizeProviderSubmission, providerSubmissionLimits } from "./provider-submission";

function submission() {
  return {
    source: "codex" as const,
    captureScope: "partial" as const,
    title: "Provider capture",
    messages: [
      {
        externalMessageId: "provider-message-1",
        role: "assistant" as const,
        content: [
          { type: "text" as const, text: "Implemented the requested change." },
          { type: "tool_call" as const, metadata: { name: "apply_patch" } },
        ],
        metadata: { model: "codex" },
      },
    ],
    metadata: { surface: "desktop" },
  };
}

describe("normalizeProviderSubmission", () => {
  it("normalizes authorized text while retaining unsupported blocks in provenance", () => {
    const result = normalizeProviderSubmission(submission());

    expect(result).toMatchObject({
      conversation: {
        source: "codex-plugin",
        title: "Provider capture",
        metadata: { captureScope: "partial", submittedMessageCount: 1 },
      },
      messageCount: 1,
      unsupportedContentCount: 1,
    });
    expect(result.warnings).toHaveLength(2);
    expect(result.conversation.nodes[0]?.externalMessageId).toBe("provider-message-1");
  });

  it("canonicalizes metadata keys for stable exact-content identity", () => {
    const left = submission();
    const right = {
      ...submission(),
      metadata: { z: 1, a: { y: true, x: false } },
    };
    const reordered = {
      ...submission(),
      metadata: { a: { x: false, y: true }, z: 1 },
    };

    expect(normalizeProviderSubmission(right).normalizedJson).toBe(
      normalizeProviderSubmission(reordered).normalizedJson,
    );
    expect(normalizeProviderSubmission(left).normalizedJson).not.toBe(
      normalizeProviderSubmission(right).normalizedJson,
    );
  });

  it("rejects non-JSON metadata and captures without supported message text", () => {
    expect(() =>
      normalizeProviderSubmission({ ...submission(), metadata: { invalid: undefined } }),
    ).toThrowError("Conversation submission is malformed.");
    expect(() =>
      normalizeProviderSubmission({
        ...submission(),
        messages: [
          {
            role: "unknown",
            content: [{ type: "tool_result", metadata: {} }],
            metadata: {},
          },
        ],
      }),
    ).toThrowError("Conversation submission contains no supported non-empty message text.");
  });

  it("retains unknown roles in provenance while excluding them from Message counts", () => {
    const result = normalizeProviderSubmission({
      ...submission(),
      messages: [
        submission().messages[0],
        {
          role: "unknown",
          content: [{ type: "text", text: "Unmapped provider actor" }],
          metadata: { providerRole: "critic" },
        },
      ],
    });

    expect(result.messageCount).toBe(1);
    expect(result.conversation.nodes).toHaveLength(2);
    expect(result.warnings.join(" ")).toContain("unknown role");
  });

  it("enforces per-message and aggregate metadata limits", () => {
    expect(() =>
      normalizeProviderSubmission({
        ...submission(),
        messages: [
          {
            role: "user",
            content: [
              { type: "text", text: "x".repeat(providerSubmissionLimits.maximumMessageBytes + 1) },
            ],
            metadata: {},
          },
        ],
      }),
    ).toThrowError(/message exceeds/);
    expect(() =>
      normalizeProviderSubmission({
        ...submission(),
        metadata: { confidential: "x".repeat(providerSubmissionLimits.maximumMetadataBytes) },
      }),
    ).toThrowError(/metadata exceeds/);
  });
});
