import { ContextService, type ModelResponse } from "@cce/application";
import { ScopedAgentService } from "@cce/agents";
import { contextItemVersionSchema } from "@cce/domain";
import { ScriptedModelProvider } from "@cce/test-support";
import { describe, expect, it } from "vitest";

import { createFixture, idsFrom, seedConversation, uuid } from "./fixtures";

function response(content: unknown): ModelResponse {
  return {
    providerResponseId: "agent-response",
    provider: "test-provider",
    model: "test-model",
    content: JSON.stringify(content),
    finishReason: "stop",
    usage: { inputTokens: 1, cachedTokens: 0, outputTokens: 1 },
  };
}

function enqueueProposal(
  provider: ScriptedModelProvider,
  evidenceMessageId: string,
  kind: "fact" | "decision",
): void {
  provider.enqueueResponse(
    response({ specialty: "extractor", reason: "Conversation evidence extraction" }),
  );
  provider.enqueueResponse(
    response({
      changes: [
        {
          operation: "add",
          evidenceMessageIds: [evidenceMessageId],
          proposal: {
            kind,
            key: kind === "decision" ? "database.choice" : "database.engine",
            value: "PostgreSQL",
            scope: { tags: [] },
            confidence: 0.9,
            explicitSupersedesVersionId: null,
          },
        },
      ],
    }),
  );
}

describe("ScopedAgentService", () => {
  it("derives branch, principal, Context, and evidence server-side and persists low-risk Delta", async () => {
    const fixture = createFixture("editor");
    const { conversation, branch, message } = seedConversation(fixture);
    const provider = new ScriptedModelProvider();
    enqueueProposal(provider, message.id, "fact");
    const service = new ScopedAgentService(
      fixture.unitOfWork,
      new ContextService(fixture.unitOfWork),
      provider,
      { ids: idsFrom(100), clock: fixture.clock, contentHasher: fixture.hasher },
    );

    const result = await service.start({
      projectId: fixture.project.id,
      conversationId: conversation.id,
      throughMessageSequence: message.sequence,
      objective: "Extract the selected database",
      actorUserId: fixture.user.id,
    });

    expect(result.run.status).toBe("completed");
    expect(result.proposal).toMatchObject({
      branchId: branch.id,
      baseCommitId: branch.baseCommitId,
      changes: [
        {
          proposal: {
            authority: "authoritative",
            provenance: [
              {
                projectId: fixture.project.id,
                conversationId: conversation.id,
                messageIds: [message.id],
                actor: message.author,
              },
            ],
          },
        },
      ],
    });
    expect(fixture.unitOfWork.view().deltas).toEqual([result.proposal]);
    expect(fixture.unitOfWork.view().auditEvents[0]).toMatchObject({
      action: "agent_run.started",
      metadata: { proposalPersisted: true },
    });
    expect(provider.requests[1]?.messages[1]?.content).toContain(message.id);
    expect(provider.requests[1]?.messages[1]?.content).toContain(branch.baseCommitId);
    await expect(
      service.list({
        projectId: fixture.project.id,
        actorUserId: fixture.user.id,
        status: "completed",
      }),
    ).resolves.toEqual([result.run]);
  });

  it("holds a high-risk proposal until an Owner explicitly approves the run", async () => {
    const fixture = createFixture("owner");
    const { conversation, message } = seedConversation(fixture);
    const provider = new ScriptedModelProvider();
    enqueueProposal(provider, message.id, "decision");
    const service = new ScopedAgentService(
      fixture.unitOfWork,
      new ContextService(fixture.unitOfWork),
      provider,
      { ids: idsFrom(100), clock: fixture.clock, contentHasher: fixture.hasher },
    );

    const awaiting = await service.start({
      projectId: fixture.project.id,
      conversationId: conversation.id,
      throughMessageSequence: message.sequence,
      objective: "Propose the database decision",
      actorUserId: fixture.user.id,
    });
    expect(awaiting.run.status).toBe("awaiting_approval");
    expect(fixture.unitOfWork.view().deltas).toHaveLength(0);
    await expect(
      service.get({
        projectId: fixture.project.id,
        runId: awaiting.run.id,
        actorUserId: fixture.user.id,
      }),
    ).resolves.toEqual(awaiting);

    const approved = await service.resume({
      projectId: fixture.project.id,
      runId: awaiting.run.id,
      actorUserId: fixture.user.id,
      decision: "approve",
      rationale: "Owner approves publishing this proposal for merge review.",
    });
    expect(approved.run.status).toBe("completed");
    expect(fixture.unitOfWork.view().deltas).toEqual([approved.proposal]);
    expect(provider.requests).toHaveLength(2);

    const replayedApproval = await service.resume({
      projectId: fixture.project.id,
      runId: awaiting.run.id,
      actorUserId: fixture.user.id,
      decision: "approve",
      rationale: "Retry the already accepted approval after a lost response.",
    });
    expect(replayedApproval).toEqual(approved);
    expect(fixture.unitOfWork.view().deltas).toEqual([approved.proposal]);
  });

  it("keeps GET read-only and repairs a missing completed proposal only via explicit reconcile", async () => {
    const fixture = createFixture("editor");
    const { conversation, message } = seedConversation(fixture);
    const provider = new ScriptedModelProvider();
    enqueueProposal(provider, message.id, "fact");
    const service = new ScopedAgentService(
      fixture.unitOfWork,
      new ContextService(fixture.unitOfWork),
      provider,
      { ids: idsFrom(100), clock: fixture.clock, contentHasher: fixture.hasher },
    );
    const completed = await service.start({
      projectId: fixture.project.id,
      conversationId: conversation.id,
      throughMessageSequence: message.sequence,
      objective: "Create a repairable proposal",
      actorUserId: fixture.user.id,
    });
    fixture.unitOfWork.view().deltas.splice(0);
    const auditCountBeforeGet = fixture.unitOfWork.view().auditEvents.length;

    await expect(
      service.get({
        projectId: fixture.project.id,
        runId: completed.run.id,
        actorUserId: fixture.user.id,
      }),
    ).resolves.toEqual(completed);
    expect(fixture.unitOfWork.view().deltas).toEqual([]);
    expect(fixture.unitOfWork.view().auditEvents).toHaveLength(auditCountBeforeGet);

    await expect(
      service.reconcile({
        projectId: fixture.project.id,
        runId: completed.run.id,
        actorUserId: fixture.user.id,
      }),
    ).resolves.toEqual(completed);
    expect(fixture.unitOfWork.view().deltas).toEqual([completed.proposal]);
    expect(fixture.unitOfWork.view().auditEvents.at(-1)?.action).toBe(
      "agent_run.reconciled",
    );
  });

  it("does not let a Viewer invoke AgentRun reconciliation", async () => {
    const fixture = createFixture("editor");
    const { conversation, message } = seedConversation(fixture);
    const provider = new ScriptedModelProvider();
    enqueueProposal(provider, message.id, "fact");
    const service = new ScopedAgentService(
      fixture.unitOfWork,
      new ContextService(fixture.unitOfWork),
      provider,
      { ids: idsFrom(100), clock: fixture.clock, contentHasher: fixture.hasher },
    );
    const completed = await service.start({
      projectId: fixture.project.id,
      conversationId: conversation.id,
      throughMessageSequence: message.sequence,
      objective: "Create a proposal that only a writer may reconcile",
      actorUserId: fixture.user.id,
    });
    fixture.unitOfWork.view().deltas.splice(0);
    const member = fixture.unitOfWork.view().members[0];
    if (member === undefined) {
      throw new Error("The Agent test fixture requires a project member.");
    }
    fixture.unitOfWork.view().members[0] = { ...member, role: "viewer" };

    await expect(
      service.get({
        projectId: fixture.project.id,
        runId: completed.run.id,
        actorUserId: fixture.user.id,
      }),
    ).resolves.toEqual(completed);
    await expect(
      service.reconcile({
        projectId: fixture.project.id,
        runId: completed.run.id,
        actorUserId: fixture.user.id,
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(fixture.unitOfWork.view().deltas).toEqual([]);
  });

  it("cancels an approval-gated run without publishing its proposal", async () => {
    const fixture = createFixture("editor");
    const { conversation, message } = seedConversation(fixture);
    const provider = new ScriptedModelProvider();
    enqueueProposal(provider, message.id, "decision");
    const service = new ScopedAgentService(
      fixture.unitOfWork,
      new ContextService(fixture.unitOfWork),
      provider,
      { ids: idsFrom(100), clock: fixture.clock, contentHasher: fixture.hasher },
    );
    const awaiting = await service.start({
      projectId: fixture.project.id,
      conversationId: conversation.id,
      throughMessageSequence: message.sequence,
      objective: "Draft a decision",
      actorUserId: fixture.user.id,
    });

    const cancelled = await service.cancel({
      projectId: fixture.project.id,
      runId: awaiting.run.id,
      actorUserId: fixture.user.id,
      rationale: "The proposal is no longer needed.",
    });

    expect(cancelled.run.status).toBe("cancelled");
    expect(fixture.unitOfWork.view().deltas).toEqual([]);
    expect(fixture.unitOfWork.view().auditEvents.at(-1)?.action).toBe(
      "agent_run.cancelled",
    );
  });

  it("rejects a viewer before invoking either manager or worker", async () => {
    const fixture = createFixture("viewer");
    const { conversation, message } = seedConversation(fixture);
    const provider = new ScriptedModelProvider();
    const service = new ScopedAgentService(
      fixture.unitOfWork,
      new ContextService(fixture.unitOfWork),
      provider,
      { ids: idsFrom(100), clock: fixture.clock, contentHasher: fixture.hasher },
    );

    await expect(
      service.start({
        projectId: fixture.project.id,
        conversationId: conversation.id,
        throughMessageSequence: message.sequence,
        objective: "This must be rejected",
        actorUserId: fixture.user.id,
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(provider.requests).toEqual([]);
    expect(fixture.unitOfWork.view().agentRuns).toEqual([]);
  });

  it("records the actual evidence sequence instead of a client-supplied future bound", async () => {
    const fixture = createFixture("editor");
    const { conversation, message } = seedConversation(fixture);
    const provider = new ScriptedModelProvider();
    enqueueProposal(provider, message.id, "fact");
    const service = new ScopedAgentService(
      fixture.unitOfWork,
      new ContextService(fixture.unitOfWork),
      provider,
      { ids: idsFrom(100), clock: fixture.clock, contentHasher: fixture.hasher },
    );

    const result = await service.start({
      projectId: fixture.project.id,
      conversationId: conversation.id,
      throughMessageSequence: 2_147_483_647,
      objective: "Extract within actual evidence",
      actorUserId: fixture.user.id,
    });

    expect(result.proposal?.throughMessageSequence).toBe(message.sequence);
  });

  it("requires Owner approval when an update downgrades a current high-risk kind", async () => {
    const fixture = createFixture("editor");
    const { conversation, message } = seedConversation(fixture);
    const current = contextItemVersionSchema.parse({
      id: uuid(30),
      logicalItemId: uuid(31),
      projectId: fixture.project.id,
      commitId: fixture.genesis.id,
      previousVersionId: null,
      kind: "decision",
      key: "database.choice",
      value: "PostgreSQL",
      scope: { tags: [] },
      authority: "authoritative",
      confidence: 1,
      provenance: [
        {
          projectId: fixture.project.id,
          conversationId: conversation.id,
          messageIds: [message.id],
          actor: message.author,
          modelRunId: null,
          recordedAt: message.createdAt,
        },
      ],
      lifecycle: "active",
      scopeHash: "a".repeat(64),
      supersedesVersionId: null,
      createdAt: message.createdAt,
    });
    fixture.unitOfWork.view().projection.set(
      `${fixture.project.id}:${current.logicalItemId}`,
      current,
    );
    const provider = new ScriptedModelProvider();
    provider.enqueueResponse(
      response({ specialty: "extractor", reason: "Review the current decision" }),
    );
    provider.enqueueResponse(
      response({
        changes: [
          {
            operation: "update",
            targetLogicalItemId: current.logicalItemId,
            expectedBaseVersionId: current.id,
            evidenceMessageIds: [message.id],
            proposal: {
              kind: "fact",
              key: current.key,
              value: "PostgreSQL",
              scope: current.scope,
              confidence: 0.9,
              explicitSupersedesVersionId: null,
            },
          },
        ],
      }),
    );
    const service = new ScopedAgentService(
      fixture.unitOfWork,
      new ContextService(fixture.unitOfWork),
      provider,
      { ids: idsFrom(100), clock: fixture.clock, contentHasher: fixture.hasher },
    );

    const result = await service.start({
      projectId: fixture.project.id,
      conversationId: conversation.id,
      throughMessageSequence: message.sequence,
      objective: "Downgrade the database decision",
      actorUserId: fixture.user.id,
    });

    expect(result.run.status).toBe("awaiting_approval");
    expect(fixture.unitOfWork.view().deltas).toEqual([]);
  });
});
