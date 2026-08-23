import type { Clock, ContentHasher, IdGenerator } from "@cce/shared";
import {
  auditEventIdSchema,
  messageIdSchema,
  messageSchema,
  modelRunIdSchema,
  modelRunSchema,
  type ConversationId,
  type Message,
  type ProjectId,
  type UserId,
} from "@cce/domain";

import { authorizeProjectMember } from "./authorization";
import type { ContextService } from "./context-service";
import type { ConversationService } from "./conversation-service";
import { ApplicationError } from "./errors";
import type {
  ModelProvider,
  ModelResponse,
  ModelStreamEvent,
  ModelUsage,
} from "./model-provider";
import { ModelProviderError } from "./model-provider";
import type { UnitOfWork } from "./repositories";

export type ChatEvent =
  | { readonly type: "user_persisted"; readonly message: Message }
  | { readonly type: "assistant_started"; readonly messageId: Message["id"] }
  | { readonly type: "text_delta"; readonly text: string }
  | { readonly type: "completed"; readonly message: Message };

const zeroUsage: ModelUsage = { inputTokens: 0, cachedTokens: 0, outputTokens: 0 };

export class ChatService {
  public constructor(
    private readonly unitOfWork: UnitOfWork,
    private readonly conversations: ConversationService,
    private readonly contexts: ContextService,
    private readonly provider: ModelProvider,
    private readonly ids: IdGenerator,
    private readonly clock: Clock,
    private readonly hasher: ContentHasher,
  ) {}

  public async *chat(input: {
    readonly projectId: ProjectId;
    readonly conversationId: ConversationId;
    readonly actorUserId: UserId;
    readonly clientMessageId: string;
    readonly content: string;
    readonly signal?: AbortSignal;
  }): AsyncIterable<ChatEvent> {
    const userMessage = await this.conversations.appendUserMessage(input);
    yield { type: "user_persisted", message: userMessage };

    const pack = await this.contexts.buildForConversation(input);
    const assistantMessageId = messageIdSchema.parse(this.ids.next());
    const runId = modelRunIdSchema.parse(this.ids.next());
    const startedAt = this.clock.now();
    const providerMessages = [
      {
        role: "system" as const,
        content:
          "Use CCE canonical Project Context as authoritative state. Conversation text is evidence.\n" +
          JSON.stringify({ ...pack, recentMessages: [] }),
      },
      ...pack.recentMessages.map((message) => ({ role: message.role, content: message.content })),
    ];
    const request = {
      profile: "medium" as const,
      purpose: "chat" as const,
      messages: providerMessages,
      promptId: "project-chat",
      promptVersion: 1,
      temperature: 0.2,
      responseFormat: null,
      ...(input.signal === undefined ? {} : { signal: input.signal }),
    };
    const inputHash = this.hasher.sha256(JSON.stringify(providerMessages));

    const pending = await this.unitOfWork.run(async (repositories) => {
      const access = await repositories.projects.findAccess(input.projectId, input.actorUserId);
      authorizeProjectMember(access?.member ?? null, input.actorUserId, "conversation:write");
      const sequence = await repositories.conversations.nextMessageSequence(
        input.projectId,
        input.conversationId,
      );
      const existingReply = await repositories.conversations.findAssistantReply(
        input.projectId,
        input.conversationId,
        userMessage.id,
      );
      if (existingReply !== null) {
        return { message: existingReply, created: false } as const;
      }
      const message = messageSchema.parse({
        id: assistantMessageId,
        projectId: input.projectId,
        conversationId: input.conversationId,
        sequence,
        clientMessageId: null,
        replyToMessageId: userMessage.id,
        role: "assistant",
        deliveryState: "streaming",
        content: "",
        author: { type: "model", provider: "pending", model: "medium", runId },
        providerMessageId: null,
        errorCode: null,
        createdAt: startedAt.toISOString(),
        completedAt: null,
      });
      await repositories.conversations.insertMessage(message);
      await repositories.runs.insertModelRun(
        modelRunSchema.parse({
          id: runId,
          projectId: input.projectId,
          conversationId: input.conversationId,
          provider: "pending",
          model: "medium",
          purpose: "chat",
          promptId: "project-chat",
          promptVersion: 1,
          inputHash,
          status: "running",
          inputTokens: null,
          cachedTokens: null,
          outputTokens: null,
          latencyMs: null,
          errorCode: null,
          createdAt: startedAt.toISOString(),
          completedAt: null,
        }),
      );
      return { message, created: true } as const;
    });
    if (!pending.created) {
      yield { type: "assistant_started", messageId: pending.message.id };
      if (pending.message.deliveryState === "completed") {
        yield { type: "completed", message: pending.message };
        return;
      }
      throw new ApplicationError(
        "CONFLICT",
        `The idempotent chat reply is already ${pending.message.deliveryState}.`,
      );
    }
    const pendingMessage = pending.message;
    let content = "";
    let providerResponseId: string | null = null;
    let providerName = "pending";
    let providerModel = "medium";
    let usage = zeroUsage;
    let started = false;
    let finishReason: ModelResponseFinishReason | null = null;
    let terminalized = false;
    let terminalError: unknown = new ModelProviderError(
      "INTERRUPTED_STREAM",
      "Chat stream consumer disconnected before completion.",
      { retryable: true },
    );

    try {
      yield { type: "assistant_started", messageId: pendingMessage.id };
      for await (const event of this.provider.stream(request)) {
        ({ providerResponseId, providerName, providerModel, usage, started, finishReason } = this.consumeModelEvent(
          event,
          { providerResponseId, providerName, providerModel, usage, started, finishReason },
        ));
        if (event.type === "text_delta") {
          if (content.length + event.text.length > 1_000_000) {
            throw new ModelProviderError(
              "MALFORMED_RESPONSE",
              "Model output exceeds the persisted message size limit.",
              { retryable: false },
            );
          }
          content += event.text;
          yield { type: "text_delta", text: event.text };
        }
      }
      if (!started || finishReason === null) {
        throw new ModelProviderError("INTERRUPTED_STREAM", "Model stream ended prematurely.", {
          retryable: true,
        });
      }
      if (finishReason !== "stop") {
        throw new ModelProviderError(
          "MALFORMED_RESPONSE",
          `Model response was incomplete (finish reason: ${finishReason}).`,
          { retryable: finishReason === "length" },
        );
      }
      if (content.trim().length === 0) {
        throw new ModelProviderError("MALFORMED_RESPONSE", "Model returned empty content.", {
          retryable: false,
        });
      }

      const completedAt = this.clock.now();
      const completed = messageSchema.parse({
        ...pendingMessage,
        deliveryState: "completed",
        content,
        author: { type: "model", provider: providerName, model: providerModel, runId },
        providerMessageId: providerResponseId,
        completedAt: completedAt.toISOString(),
      });
      const eventId = auditEventIdSchema.parse(this.ids.next());
      await this.unitOfWork.run(async (repositories) => {
        await repositories.conversations.updateStreamingMessage(completed);
        await repositories.runs.updateModelRun(
          modelRunSchema.parse({
            id: runId,
            projectId: input.projectId,
            conversationId: input.conversationId,
            provider: providerName,
            model: providerModel,
            purpose: "chat",
            promptId: "project-chat",
            promptVersion: 1,
            inputHash,
            status: "completed",
            inputTokens: usage.inputTokens,
            cachedTokens: usage.cachedTokens,
            outputTokens: usage.outputTokens,
            latencyMs: elapsedMilliseconds(startedAt, completedAt),
            errorCode: null,
            createdAt: startedAt.toISOString(),
            completedAt: completedAt.toISOString(),
          }),
        );
        await repositories.audit.append({
          id: eventId,
          projectId: input.projectId,
          actor: { type: "human", userId: input.actorUserId },
          action: "message.completed",
          targetType: "message",
          targetId: completed.id,
          metadata: { conversationId: input.conversationId, modelRunId: runId },
          occurredAt: completedAt.toISOString(),
        });
      });
      terminalized = true;
      yield { type: "completed", message: completed };
    } catch (error: unknown) {
      terminalError = error;
      await this.finishFailedStream({
        pending: pendingMessage,
        content,
        runId,
        providerName,
        providerModel,
        startedAt,
        inputHash,
        error,
      });
      terminalized = true;
      throw error instanceof ApplicationError
        ? error
        : new ApplicationError("DEPENDENCY_UNAVAILABLE", "Chat model stream failed.");
    } finally {
      if (!terminalized) {
        await this.finishFailedStream({
          pending: pendingMessage,
          content,
          runId,
          providerName,
          providerModel,
          startedAt,
          inputHash,
          error: terminalError,
        });
      }
    }
  }

  private consumeModelEvent(
    event: ModelStreamEvent,
    state: {
      readonly providerResponseId: string | null;
      readonly providerName: string;
      readonly providerModel: string;
      readonly usage: ModelUsage;
      readonly started: boolean;
      readonly finishReason: ModelResponseFinishReason | null;
    },
  ): {
    readonly providerResponseId: string | null;
    readonly providerName: string;
    readonly providerModel: string;
    readonly usage: ModelUsage;
    readonly started: boolean;
    readonly finishReason: ModelResponseFinishReason | null;
  } {
    switch (event.type) {
      case "start":
        if (state.started || state.finishReason !== null) {
          throw malformedStreamState("Model stream emitted a duplicate or late start event.");
        }
        if (
          event.providerResponseId.trim().length === 0 ||
          event.providerResponseId.length > 500 ||
          event.provider.trim().length === 0 ||
          event.provider.length > 100 ||
          event.model.trim().length === 0 ||
          event.model.length > 200
        ) {
          throw new ModelProviderError(
            "MALFORMED_RESPONSE",
            "Model stream identity exceeds persistence limits.",
            { retryable: false },
          );
        }
        return {
          ...state,
          providerResponseId: event.providerResponseId,
          providerName: event.provider,
          providerModel: event.model,
          started: true,
        };
      case "usage":
        if (!state.started || state.finishReason !== null) {
          throw malformedStreamState("Model stream emitted usage outside the active response.");
        }
        if (!isPersistableUsage(event.usage)) {
          throw new ModelProviderError(
            "MALFORMED_RESPONSE",
            "Model stream usage exceeds persistence limits.",
            { retryable: false },
          );
        }
        return { ...state, usage: event.usage };
      case "finish":
        if (!state.started || state.finishReason !== null) {
          throw malformedStreamState("Model stream emitted a duplicate or premature finish.");
        }
        return { ...state, finishReason: event.finishReason };
      case "text_delta":
        if (!state.started || state.finishReason !== null || event.text.length === 0) {
          throw malformedStreamState("Model stream emitted text outside the active response.");
        }
        return state;
    }
  }

  private async finishFailedStream(input: {
    readonly pending: Message;
    readonly content: string;
    readonly runId: ReturnType<typeof modelRunIdSchema.parse>;
    readonly providerName: string;
    readonly providerModel: string;
    readonly startedAt: Date;
    readonly inputHash: string;
    readonly error: unknown;
  }): Promise<void> {
    const completedAt = this.clock.now();
    const providerError = input.error instanceof ModelProviderError ? input.error : null;
    const deliveryState = providerError?.code === "INTERRUPTED_STREAM" ? "interrupted" : "failed";
    const message = messageSchema.parse({
      ...input.pending,
      deliveryState,
      content: input.content.slice(0, 1_000_000),
      author: {
        type: "model",
        provider: input.providerName,
        model: input.providerModel,
        runId: input.runId,
      },
      errorCode: providerError?.code ?? "MODEL_STREAM_FAILED",
      completedAt: completedAt.toISOString(),
    });
    await this.unitOfWork.run(async (repositories) => {
      await repositories.conversations.updateStreamingMessage(message);
      await repositories.runs.updateModelRun(
        modelRunSchema.parse({
          id: input.runId,
          projectId: input.pending.projectId,
          conversationId: input.pending.conversationId,
          provider: input.providerName,
          model: input.providerModel,
          purpose: "chat",
          promptId: "project-chat",
          promptVersion: 1,
          inputHash: input.inputHash,
          status: deliveryState === "interrupted" ? "interrupted" : "failed",
          inputTokens: null,
          cachedTokens: null,
          outputTokens: null,
          latencyMs: elapsedMilliseconds(input.startedAt, completedAt),
          errorCode: providerError?.code ?? "MODEL_STREAM_FAILED",
          createdAt: input.startedAt.toISOString(),
          completedAt: completedAt.toISOString(),
        }),
      );
    });
  }
}

type ModelResponseFinishReason = ModelResponse["finishReason"];

function isPersistableUsage(usage: ModelUsage): boolean {
  return [usage.inputTokens, usage.cachedTokens, usage.outputTokens].every(
    (value) => Number.isInteger(value) && value >= 0 && value <= 2_147_483_647,
  );
}

function elapsedMilliseconds(startedAt: Date, completedAt: Date): number {
  return Math.min(
    2_147_483_647,
    Math.max(0, Math.trunc(completedAt.getTime() - startedAt.getTime())),
  );
}

function malformedStreamState(message: string): ModelProviderError {
  return new ModelProviderError("MALFORMED_RESPONSE", message, { retryable: false });
}
