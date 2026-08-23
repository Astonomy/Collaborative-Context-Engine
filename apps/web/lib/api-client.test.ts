// @vitest-environment jsdom

import { projectResponseSchema } from "@cce/api-contracts";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ApiClientError, requestJson, streamChat } from "./api-client";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("requestJson", () => {
  it("validates successful response payloads", async () => {
    const project = {
      id: "00000000-0000-4000-8000-000000000001",
      name: "Atlas",
      headCommitId: "00000000-0000-4000-8000-000000000002",
      version: 0,
      createdBy: "00000000-0000-4000-8000-000000000003",
      createdAt: "2026-08-23T10:00:00.000Z",
      archivedAt: null,
    };
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify(project), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      ),
    );
    await expect(requestJson("/api/projects/1", projectResponseSchema)).resolves.toEqual(project);
  });

  it("normalizes a contracted API failure", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            error: {
              code: "FORBIDDEN",
              message: "Owner approval is required.",
              details: { requestId: "request-1" },
            },
          }),
          { status: 403, headers: { "content-type": "application/json" } },
        ),
      ),
    );
    const failure = await requestJson("/api/projects/1", projectResponseSchema).catch(
      (error: unknown) => error,
    );
    expect(failure).toBeInstanceOf(ApiClientError);
    expect(failure).toMatchObject({ status: 403, code: "FORBIDDEN" });
  });
});

describe("streamChat", () => {
  it("decodes fragmented SSE events and validates each event", async () => {
    const chunks = [
      'event: assistant_started\ndata: {"type":"assistant_started","messageId":"00000000-0000-4000-8000-',
      '000000000010"}\n\nevent: text_delta\ndata: {"type":"text_delta","text":"Hello"}\n\n',
    ];
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        for (const chunk of chunks) {
          controller.enqueue(new TextEncoder().encode(chunk));
        }
        controller.close();
      },
    });
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(stream, {
          status: 200,
          headers: { "content-type": "text/event-stream" },
        }),
      ),
    );
    const events: unknown[] = [];
    await streamChat(
      "/api/chat",
      { clientMessageId: "00000000-0000-4000-8000-000000000001", content: "Hi" },
      (event) => events.push(event),
    );
    expect(events).toEqual([
      {
        type: "assistant_started",
        messageId: "00000000-0000-4000-8000-000000000010",
      },
      { type: "text_delta", text: "Hello" },
    ]);
  });
});
