import type { Clock, ContentHasher, IdGenerator } from "@cce/shared";
import { jsonValueSchema } from "@cce/shared";
import { buildContextPack } from "@cce/context-engine";
import {
  auditEventIdSchema,
  contextDeltaChangeSchema,
  contextDeltaIdSchema,
  contextDeltaSchema,
  contextItemProposalSchema,
  contextScopeSchema,
  deltaChangeIdSchema,
  logicalContextItemIdSchema,
  messageIdSchema,
  modelRunIdSchema,
  modelRunSchema,
  contextItemVersionIdSchema,
  type ContextDelta,
  type ConversationId,
  type ProjectId,
  type Provenance,
  type UserId,
} from "@cce/domain";
import { z } from "zod";

import { authorizeProjectMember, requireActiveProject } from "./authorization";
import { ApplicationError } from "./errors";
import type { ModelProvider, ModelResponse } from "./model-provider";
import { ModelProviderError } from "./model-provider";
import type { UnitOfWork } from "./repositories";

const extractorKindSchema = z.enum([
  "fact",
  "decision",
  "requirement",
  "assumption",
  "task",
  "question",
]);

const extractionProposalSchema = z
  .object({
    kind: extractorKindSchema,
    key: contextItemProposalSchema.shape.key,
    value: contextItemProposalSchema.shape.value,
    scope: contextScopeSchema,
    confidence: z.number().min(0).max(1),
    evidenceMessageIds: z.array(z.uuid()).min(1).max(500),
  })
  .strict();

const extractedChangeSchema = z.discriminatedUnion("operation", [
  z.object({ operation: z.literal("add"), proposal: extractionProposalSchema }).strict(),
  z
    .object({
      operation: z.literal("update"),
      targetLogicalItemId: z.uuid(),
      expectedBaseVersionId: z.uuid(),
      proposal: extractionProposalSchema,
    })
    .strict(),
  z
    .object({
      operation: z.literal("supersede"),
      targetLogicalItemId: z.uuid(),
      expectedBaseVersionId: z.uuid(),
      proposal: extractionProposalSchema,
    })
    .strict(),
]);

const extractedDeltaSchema = z
  .object({
    // Keep the Delta envelope; all topics belong inside one proposal's JSON value.
    changes: z.array(extractedChangeSchema).length(1),
  })
  .strict();

function parseJson(text: string): unknown {
  return JSON.parse(text) as unknown;
}

export class ExtractionService {
  public constructor(
    private readonly unitOfWork: UnitOfWork,
    private readonly provider: ModelProvider,
    private readonly ids: IdGenerator,
    private readonly clock: Clock,
    private readonly hasher: ContentHasher,
  ) {}

  public async extract(input: {
    readonly projectId: ProjectId;
    readonly conversationId: ConversationId;
    readonly actorUserId: UserId;
    readonly throughMessageSequence?: number;
    readonly signal?: AbortSignal;
  }): Promise<ContextDelta> {
    const runId = modelRunIdSchema.parse(this.ids.next());
    const startedAt = this.clock.now();
    const readable = await this.unitOfWork.run(async (repositories) => {
      const access = await repositories.projects.findAccess(input.projectId, input.actorUserId);
      authorizeProjectMember(access?.member ?? null, input.actorUserId, "context:propose");
      if (access === null) {
        throw new ApplicationError("NOT_FOUND", "Project was not found.");
      }
      requireActiveProject(access.project);
      const conversation = await repositories.conversations.find(
        input.projectId,
        input.conversationId,
      );
      if (access === null || conversation === null) {
        throw new ApplicationError("NOT_FOUND", "Conversation was not found.");
      }
      const branch = await repositories.conversations.findBranch(
        input.projectId,
        conversation.branchId,
      );
      if (branch === null || branch.status !== "open") {
        throw new ApplicationError("CONFLICT", "Conversation Branch is not open.");
      }
      const [messages, snapshot] = await Promise.all([
        repositories.conversations.listMessages(input.projectId, input.conversationId),
        repositories.context.getHeadSnapshot(input.projectId),
      ]);
      if (snapshot === null) {
        throw new ApplicationError("CONFLICT", "Project Context HEAD is unavailable.");
      }
      return { access, conversation, branch, messages, snapshot };
    });

    buildContextPack({
      project: {
        id: readable.access.project.id,
        name: readable.access.project.name,
        headCommitId: readable.snapshot.commitId,
        version: readable.snapshot.version,
      },
      items: readable.snapshot.items,
      messages: [],
      maxRecentMessages: 0,
      recentMessageCharacterBudget: 0,
    });
    const eligibleMessages = readable.messages
      .filter(
        (message) =>
          message.deliveryState === "completed" &&
          message.sequence <= (input.throughMessageSequence ?? Number.MAX_SAFE_INTEGER),
      )
      .sort((left, right) => right.sequence - left.sequence);
    const selectedMessages = [] as typeof eligibleMessages;
    let selectedCharacters = 0;
    for (const message of eligibleMessages) {
      if (
        selectedMessages.length >= 500 ||
        selectedCharacters + message.content.length > 1_000_000
      ) {
        break;
      }
      selectedMessages.push(message);
      selectedCharacters += message.content.length;
    }
    const completedMessages = selectedMessages.sort(
      (left, right) => left.sequence - right.sequence,
    );
    if (completedMessages.length === 0) {
      throw new ApplicationError("VALIDATION", "No completed messages are available to extract.");
    }
    const throughMessageSequence = Math.max(...completedMessages.map((message) => message.sequence));
    const providerMessages = [
      {
        role: "system" as const,
        content:
          "Extract only semantic changes supported by the supplied message IDs. Return strict JSON. " +
          "Do not approve changes and do not invent provenance. " +
          "The input represents one complete conversation-level work unit. " +
          "Treat the entire conversation as one coherent module or project context. " +
          "Read all messages together before extracting information. " +
          "Messages are evidence belonging to the same conversation; they are not independent extraction units. " +
          "Produce exactly one merged conversation-level extraction proposal in the changes array. " +
          "Consolidate duplicate, repeated, updated, or related information across messages. " +
          "Later messages may refine, replace, or supersede earlier statements when the conversation clearly indicates this. " +
          "Preserve requirements, constraints, decisions, implementation details, unresolved issues, files, paths, " +
          "commands, errors, and next steps as structured information inside the single proposal's value. " +
          "Do not split the conversation into multiple top-level extraction records because it contains multiple topics or stages. " +
          "Use a conversation-level key, and cite the supplied message IDs supporting the merged information. " +
          "Use add for a new work unit, or update/supersede for an existing record of this conversation; " +
          "represent retired details inside the merged value instead of a standalone deprecation. " +
          "Current project items are background context; do not merge separate conversations into one extraction record. " +
          "The output represents what this conversation, considered as a whole, contributes to the project.",
      },
      {
        role: "user" as const,
        content: JSON.stringify({
          baseCommitId: readable.branch.baseCommitId,
          currentItems: readable.snapshot.items,
          conversation: readable.conversation,
          messages: completedMessages.map((message) => ({
            id: message.id,
            role: message.role,
            author: message.author,
            content: message.content,
            sequence: message.sequence,
          })),
        }),
      },
    ];
    const inputHash = this.hasher.sha256(JSON.stringify(providerMessages));
    const running = modelRunSchema.parse({
      id: runId,
      projectId: input.projectId,
      conversationId: input.conversationId,
      provider: "pending",
      model: "medium",
      purpose: "extraction",
      promptId: "context-extractor",
      promptVersion: 2,
      inputHash,
      status: "running",
      inputTokens: null,
      cachedTokens: null,
      outputTokens: null,
      latencyMs: null,
      errorCode: null,
      createdAt: startedAt.toISOString(),
      completedAt: null,
    });
    await this.unitOfWork.run((repositories) => repositories.runs.insertModelRun(running));

    try {
      const { response, extracted } = await this.generateStructured(
        providerMessages,
        input.signal,
      );
      assertPersistableResponse(response);
      const messageIds = new Set(completedMessages.map((message) => message.id));
      for (const change of extracted.changes) {
        if (
          change.proposal.evidenceMessageIds.some(
            (messageId) => !messageIds.has(messageIdSchema.parse(messageId)),
          )
        ) {
          throw new ApplicationError(
            "VALIDATION",
            "Extractor referenced evidence outside the requested Conversation range.",
          );
        }
      }

      const completedAt = this.clock.now();
      const modelActor = {
        type: "model" as const,
        provider: response.provider,
        model: response.model,
        runId,
      };
      const provenanceFor = (rawMessageIds: readonly string[]): Provenance[] => {
        const messageIds = [...new Set(rawMessageIds)].map((id) => messageIdSchema.parse(id));
        const provenance: Provenance[] = [];
        // One merged proposal can cite the full bounded conversation. Each existing
        // provenance entry supports 100 messages; no evidence schema change is needed.
        for (let offset = 0; offset < messageIds.length; offset += 100) {
          provenance.push({
            projectId: input.projectId,
            conversationId: input.conversationId,
            messageIds: messageIds.slice(offset, offset + 100),
            actor: modelActor,
            modelRunId: runId,
            recordedAt: completedAt.toISOString(),
          });
        }
        return provenance;
      };
      const changes = extracted.changes.map((candidate) => {
        const id = deltaChangeIdSchema.parse(this.ids.next());
        const proposal = contextItemProposalSchema.parse({
          kind: candidate.proposal.kind,
          key: candidate.proposal.key,
          value: candidate.proposal.value,
          scope: candidate.proposal.scope,
          authority: "authoritative",
          confidence: candidate.proposal.confidence,
          provenance: provenanceFor(candidate.proposal.evidenceMessageIds),
          explicitSupersedesVersionId:
            candidate.operation === "supersede"
              ? contextItemVersionIdSchema.parse(candidate.expectedBaseVersionId)
              : null,
        });
        if (candidate.operation === "add") {
          return contextDeltaChangeSchema.parse({ id, operation: "add", proposal });
        }
        return contextDeltaChangeSchema.parse({
          id,
          operation: candidate.operation,
          targetLogicalItemId: logicalContextItemIdSchema.parse(candidate.targetLogicalItemId),
          expectedBaseVersionId: contextItemVersionIdSchema.parse(candidate.expectedBaseVersionId),
          proposal,
        });
      });
      const delta = contextDeltaSchema.parse({
        id: contextDeltaIdSchema.parse(this.ids.next()),
        projectId: input.projectId,
        branchId: readable.branch.id,
        conversationId: input.conversationId,
        baseCommitId: readable.branch.baseCommitId,
        throughMessageSequence,
        schemaVersion: 1,
        extractorRunId: runId,
        revisionOf: null,
        contentHash: this.hasher.sha256(JSON.stringify(extracted)),
        proposedBy: modelActor,
        createdAt: completedAt.toISOString(),
        changes,
      });
      const eventId = auditEventIdSchema.parse(this.ids.next());
      await this.unitOfWork.run(async (repositories) => {
        const access = await repositories.projects.findAccess(input.projectId, input.actorUserId);
        authorizeProjectMember(access?.member ?? null, input.actorUserId, "context:propose");
        if (access === null) {
          throw new ApplicationError("NOT_FOUND", "Project was not found.");
        }
        requireActiveProject(access.project);
        await repositories.context.insertDelta(delta);
        await repositories.runs.updateModelRun(
          modelRunSchema.parse({
            ...running,
            provider: response.provider,
            model: response.model,
            status: "completed",
            inputTokens: response.usage.inputTokens,
            cachedTokens: response.usage.cachedTokens,
            outputTokens: response.usage.outputTokens,
            latencyMs: elapsedMilliseconds(startedAt, completedAt),
            completedAt: completedAt.toISOString(),
          }),
        );
        await repositories.audit.append({
          id: eventId,
          projectId: input.projectId,
          actor: { type: "human", userId: input.actorUserId },
          action: "context_delta.extracted",
          targetType: "context_delta",
          targetId: delta.id,
          metadata: { changes: delta.changes.length, modelRunId: runId },
          occurredAt: completedAt.toISOString(),
        });
      });
      return delta;
    } catch (error: unknown) {
      const completedAt = this.clock.now();
      await this.unitOfWork.run((repositories) =>
        repositories.runs.updateModelRun(
          modelRunSchema.parse({
            ...running,
            status: "failed",
            latencyMs: elapsedMilliseconds(startedAt, completedAt),
            errorCode:
              error instanceof ModelProviderError ? error.code : "MALFORMED_STRUCTURED_OUTPUT",
            completedAt: completedAt.toISOString(),
          }),
        ),
      );
      if (error instanceof ApplicationError) {
        throw error;
      }
      if (
        error instanceof z.ZodError ||
        (error instanceof ModelProviderError && error.code === "MALFORMED_RESPONSE")
      ) {
        throw new ApplicationError("VALIDATION", "Model returned an invalid Context proposal.");
      }
      throw new ApplicationError("DEPENDENCY_UNAVAILABLE", "Context extraction failed.");
    }
  }

  private async generateStructured(
    messages: readonly { readonly role: "system" | "user"; readonly content: string }[],
    signal?: AbortSignal,
  ): Promise<{
    readonly response: ModelResponse;
    readonly extracted: z.infer<typeof extractedDeltaSchema>;
  }> {
    const responseFormat = {
      name: "context_delta_extraction",
      schema: jsonValueSchema.parse(z.toJSONSchema(extractedDeltaSchema)),
      strict: true as const,
    };
    let lastResponse: ModelResponse | null = null;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const requestMessages =
        attempt === 0
          ? messages
          : [
              ...messages,
              {
                role: "system" as const,
                content: "The previous response was invalid. Return only JSON matching the schema.",
              },
            ];
      try {
        lastResponse = await this.provider.generate({
          profile: "medium",
          purpose: "extraction",
          messages: requestMessages,
          promptId: "context-extractor",
          promptVersion: 2,
          temperature: 0,
          responseFormat,
          ...(signal === undefined ? {} : { signal }),
        });
      } catch (error: unknown) {
        if (error instanceof ModelProviderError && error.code === "MALFORMED_RESPONSE") {
          if (attempt === 0) {
            continue;
          }
          throw new ApplicationError("VALIDATION", "Model returned malformed structured output.");
        }
        throw error;
      }
      if (lastResponse.finishReason !== "stop") {
        throw new ModelProviderError(
          "MALFORMED_RESPONSE",
          `Structured response was incomplete (finish reason: ${lastResponse.finishReason}).`,
          { retryable: lastResponse.finishReason === "length" },
        );
      }
      let parsed: unknown;
      try {
        if (lastResponse.content.trim() === "") {
          throw new ApplicationError("VALIDATION", "Model returned empty message.content.");
        }
        parsed = parseJson(lastResponse.content);
        const extracted = extractedDeltaSchema.safeParse(parsed);
        if (!extracted.success) {
          throw extracted.error;
        }
        return {
          response: lastResponse,
          extracted: extracted.data,
        };
      } catch (error: unknown) {
        if (
          !(error instanceof SyntaxError) &&
          !(error instanceof z.ZodError) &&
          !(error instanceof ApplicationError)
        ) {
          throw error;
        }
        if (process.env["NODE_ENV"] === "development" || process.env["NODE_ENV"] === "test") {
          console.error("Model extraction output rejected", {
            reason:
              error instanceof z.ZodError
                ? "INVALID_SCHEMA"
                : error instanceof ApplicationError
                  ? "EMPTY_CONTENT"
                  : "INVALID_JSON",
            responseCharacterLength: lastResponse.content.length,
            topLevelKeys:
              parsed !== null && typeof parsed === "object" ? Object.keys(parsed).slice(0, 20) : [],
            issues:
              error instanceof z.ZodError
                ? error.issues.slice(0, 20).map(({ code, path }) => ({ code, path }))
                : [],
          });
        }
        if (attempt === 1) {
          if (error instanceof ApplicationError) {
            throw error;
          }
          throw new ApplicationError(
            "VALIDATION",
            error instanceof SyntaxError
              ? "Model returned invalid JSON."
              : "Model returned an invalid Context proposal.",
          );
        }
      }
    }
    throw new ApplicationError(
      "DEPENDENCY_UNAVAILABLE",
      lastResponse === null ? "Model produced no response." : "Model response was not usable.",
    );
  }
}

function assertPersistableResponse(response: ModelResponse): void {
  const identityIsValid =
    response.providerResponseId.trim().length > 0 &&
    response.providerResponseId.length <= 500 &&
    response.provider.trim().length > 0 &&
    response.provider.length <= 100 &&
    response.model.trim().length > 0 &&
    response.model.length <= 200;
  const usageIsValid = [
    response.usage.inputTokens,
    response.usage.cachedTokens,
    response.usage.outputTokens,
  ].every(
    (value) => Number.isInteger(value) && value >= 0 && value <= 2_147_483_647,
  );
  if (!identityIsValid || !usageIsValid || response.content.length > 1_000_000) {
    throw new ModelProviderError(
      "MALFORMED_RESPONSE",
      "Structured model response exceeds persistence limits.",
      { retryable: false },
    );
  }
}

function elapsedMilliseconds(startedAt: Date, completedAt: Date): number {
  return Math.min(
    2_147_483_647,
    Math.max(0, Math.trunc(completedAt.getTime() - startedAt.getTime())),
  );
}
