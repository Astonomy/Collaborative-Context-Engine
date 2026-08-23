"use client";

import {
  apiErrorResponseSchema,
  chatStreamEventSchema,
  type ApiErrorResponse,
  type ChatStreamEvent,
} from "@cce/api-contracts";
import type { z } from "zod";

export class ApiClientError extends Error {
  public readonly status: number;
  public readonly code: ApiErrorResponse["error"]["code"];
  public readonly details: Readonly<Record<string, string>>;

  public constructor(status: number, failure: ApiErrorResponse) {
    super(failure.error.message);
    this.name = "ApiClientError";
    this.status = status;
    this.code = failure.error.code;
    this.details = failure.error.details;
  }
}

export async function requestJson<Schema extends z.ZodType>(
  path: string,
  schema: Schema,
  init: RequestInit = {},
): Promise<z.output<Schema>> {
  const headers = new Headers(init.headers);
  if (init.body !== undefined && !headers.has("content-type")) {
    headers.set("content-type", "application/json");
  }
  const response = await fetch(path, {
    ...init,
    headers,
    credentials: "same-origin",
    cache: "no-store",
  });
  const payload: unknown = await response.json();
  if (!response.ok) {
    const failure = apiErrorResponseSchema.safeParse(payload);
    if (failure.success) {
      throw new ApiClientError(response.status, failure.data);
    }
    throw new Error(`CCE API failed with HTTP ${response.status}.`);
  }
  return schema.parse(payload);
}

export async function streamChat(
  path: string,
  body: Readonly<{ clientMessageId: string; content: string }>,
  onEvent: (event: ChatStreamEvent) => void,
  signal?: AbortSignal,
): Promise<void> {
  const response = await fetch(path, {
    method: "POST",
    credentials: "same-origin",
    cache: "no-store",
    headers: { "content-type": "application/json", accept: "text/event-stream" },
    body: JSON.stringify(body),
    ...(signal === undefined ? {} : { signal }),
  });
  if (!response.ok) {
    const payload: unknown = await response.json();
    const failure = apiErrorResponseSchema.safeParse(payload);
    if (failure.success) {
      throw new ApiClientError(response.status, failure.data);
    }
    throw new Error(`CCE chat failed with HTTP ${response.status}.`);
  }
  if (response.body === null) {
    throw new Error("CCE chat returned an empty stream.");
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  while (true) {
    const result = await reader.read();
    buffer += decoder.decode(result.value, { stream: !result.done });
    const blocks = buffer.split(/\r?\n\r?\n/);
    buffer = blocks.pop() ?? "";
    for (const block of blocks) {
      consumeSseBlock(block, onEvent);
    }
    if (result.done) {
      if (buffer.trim().length > 0) {
        consumeSseBlock(buffer, onEvent);
      }
      return;
    }
  }
}

function consumeSseBlock(block: string, onEvent: (event: ChatStreamEvent) => void): void {
  let eventName = "message";
  const dataLines: string[] = [];
  for (const line of block.split(/\r?\n/)) {
    if (line.startsWith("event:")) {
      eventName = line.slice("event:".length).trim();
    } else if (line.startsWith("data:")) {
      dataLines.push(line.slice("data:".length).trimStart());
    }
  }
  if (dataLines.length === 0) {
    return;
  }
  const parsed: unknown = JSON.parse(dataLines.join("\n"));
  if (eventName === "error") {
    const failure = apiErrorResponseSchema.parse(parsed);
    throw new ApiClientError(503, failure);
  }
  onEvent(chatStreamEventSchema.parse(parsed));
}
