import {
  ApplicationError,
  type ModelProvider,
  type ModelRequest,
  type ModelResponse,
  type ModelStreamEvent,
} from "@cce/application";
import {
  branchIdSchema,
  contextCommitIdSchema,
  contextDeltaSchema,
  contextItemVersionIdSchema,
  conversationIdSchema,
  logicalContextItemIdSchema,
  messageIdSchema,
  projectIdSchema,
  userIdSchema,
  type AgentRun,
  type AgentRunId,
  type ProjectId,
} from "@cce/domain";
import { describe, expect, it } from "vitest";

import {
  ContextDeltaAgentWorkflow,
  agentDeltaDraftSchema,
  agentWorkflowStateSchema,
  startAgentWorkflowInputSchema,
  type AgentWorkflowRunStore,
  type ResearchTool,
  type StartAgentWorkflowInput,
} from "./index";

const ids = {
  project: projectIdSchema.parse("00000000-0000-4000-8000-000000000001"),
  conversation: conversationIdSchema.parse("00000000-0000-4000-8000-000000000002"),
  branch: branchIdSchema.parse("00000000-0000-4000-8000-000000000003"),
  baseCommit: contextCommitIdSchema.parse("00000000-0000-4000-8000-000000000004"),
  user: userIdSchema.parse("00000000-0000-4000-8000-000000000005"),
  owner: userIdSchema.parse("00000000-0000-4000-8000-000000000006"),
  message: messageIdSchema.parse("00000000-0000-4000-8000-000000000007"),
  logicalItem: logicalContextItemIdSchema.parse("00000000-0000-4000-8000-000000000008"),
  baseVersion: contextItemVersionIdSchema.parse("00000000-0000-4000-8000-000000000009"),
} as const;

class MemoryRunStore implements AgentWorkflowRunStore {
  public readonly history: AgentRun[] = [];
  private readonly runs = new Map<string, AgentRun>();

  public async insertAgentRun(run: AgentRun): Promise<void> {
    this.runs.set(run.id, run);
    this.history.push(run);
  }

  public async updateAgentRun(run: AgentRun, expectedVersion: number): Promise<boolean> {
    if (this.runs.get(run.id)?.version !== expectedVersion) return false;
    this.runs.set(run.id, run);
    this.history.push(run);
    return true;
  }

  public async findAgentRun(projectId: ProjectId, runId: AgentRunId): Promise<AgentRun | null> {
    const run = this.runs.get(runId);
    return run?.projectId === projectId ? run : null;
  }
}

class SequenceModelProvider implements ModelProvider {
  public readonly requests: ModelRequest[] = [];

  public constructor(private readonly responses: Array<ModelResponse | Error>) {}

  public async generate(request: ModelRequest): Promise<ModelResponse> {
    this.requests.push(request);
    const response = this.responses.shift();
    if (response === undefined) {
      throw new Error("No fake response configured");
    }
    if (response instanceof Error) {
      throw response;
    }
    return response;
  }

  public async *stream(): AsyncIterable<ModelStreamEvent> {
    yield { type: "finish", finishReason: "stop" };
  }
}

class SequenceIds {
  private nextValue = 100;

  public next(): string {
    const suffix = String(this.nextValue).padStart(12, "0");
    this.nextValue += 1;
    return `00000000-0000-4000-8000-${suffix}`;
  }
}

class FixedRuntime {
  public readonly ids = new SequenceIds();
  public readonly clock = { now: (): Date => new Date("2026-08-23T00:00:00.000Z") };
  public readonly contentHasher = { sha256: (): string => "a".repeat(64) };
}

class ConfigurableResearchTool implements ResearchTool {
  public calls = 0;

  public constructor(private readonly output: unknown) {}

  public async research(): Promise<unknown> {
    this.calls += 1;
    if (this.output instanceof Error) {
      throw this.output;
    }
    return this.output;
  }
}

function modelResponse(
  content: unknown,
  finishReason: ModelResponse["finishReason"] = "stop",
): ModelResponse {
  return {
    providerResponseId: "response-1",
    provider: "fake",
    model: "fake-model",
    content: typeof content === "string" ? content : JSON.stringify(content),
    finishReason,
    usage: { inputTokens: 10, cachedTokens: 0, outputTokens: 10 },
  };
}

function managerResponse(specialty: "extractor" | "research" | "review" | "merge"): ModelResponse {
  return modelResponse({ specialty, reason: `Use ${specialty} for this objective.` });
}

function deltaDraft(kind: "fact" | "decision" = "fact"): ModelResponse {
  return modelResponse({
    changes: [
      {
        operation: "add",
        evidenceMessageIds: [ids.message],
        proposal: {
          kind,
          key: kind === "fact" ? "runtime.node" : "api.protocol",
          value: kind === "fact" ? "Node.js 24" : "REST",
          scope: { tags: ["architecture"] },
          confidence: 0.95,
          explicitSupersedesVersionId: null,
        },
      },
    ],
  });
}

function allOperationsDraft(): ModelResponse {
  const proposal = {
    kind: "task",
    key: "delivery.next_step",
    value: "Run validation",
    scope: { tags: ["delivery"] },
    confidence: 0.9,
    explicitSupersedesVersionId: null,
  } as const;
  return modelResponse({
    changes: [
      {
        operation: "update",
        targetLogicalItemId: ids.logicalItem,
        expectedBaseVersionId: ids.baseVersion,
        evidenceMessageIds: [ids.message],
        proposal,
      },
      {
        operation: "supersede",
        targetLogicalItemId: "00000000-0000-4000-8000-000000000010",
        expectedBaseVersionId: "00000000-0000-4000-8000-000000000011",
        evidenceMessageIds: [ids.message],
        proposal: {
          ...proposal,
          key: "delivery.superseded_step",
          explicitSupersedesVersionId: "00000000-0000-4000-8000-000000000011",
        },
      },
      {
        operation: "deprecate",
        targetLogicalItemId: "00000000-0000-4000-8000-000000000012",
        expectedBaseVersionId: "00000000-0000-4000-8000-000000000013",
        evidenceMessageIds: [ids.message],
      },
    ],
  });
}

function startInput(role: "owner" | "editor" | "viewer" = "editor"): StartAgentWorkflowInput {
  return {
    projectId: ids.project,
    conversationId: ids.conversation,
    branchId: ids.branch,
    baseCommitId: ids.baseCommit,
    throughMessageSequence: 1,
    objective: "Extract durable project context",
    routedContext: "The runtime is Node.js 24 and the API is REST.",
    currentItems: [],
    evidence: [
      {
        messageId: ids.message,
        sequence: 1,
        actor: { type: "human", userId: ids.user },
      },
    ],
    principal: { userId: ids.user, role },
  };
}

function workflowWith(
  responses: Array<ModelResponse | Error>,
  researchTool: ResearchTool | null = null,
): {
  readonly workflow: ContextDeltaAgentWorkflow;
  readonly store: MemoryRunStore;
  readonly provider: SequenceModelProvider;
} {
  const store = new MemoryRunStore();
  const provider = new SequenceModelProvider(responses);
  return {
    workflow: new ContextDeltaAgentWorkflow(store, provider, new FixedRuntime(), researchTool),
    store,
    provider,
  };
}

describe("ContextDeltaAgentWorkflow", () => {
  it.each(["extractor", "review", "merge"] as const)(
    "has the manager select the %s specialty and completes a low-risk proposal",
    async (specialty) => {
      const { workflow, store } = workflowWith([managerResponse(specialty), deltaDraft()]);

      const result = await workflow.start(startInput());

      expect(result.run.status).toBe("completed");
      expect(result.proposal).not.toBeNull();
      expect(contextDeltaSchema.safeParse(result.proposal).success).toBe(true);
      expect(result).not.toHaveProperty("commit");
      expect(result.proposal).toMatchObject({
        projectId: ids.project,
        conversationId: ids.conversation,
        proposedBy: { type: "agent", agentName: specialty, runId: result.run.id },
      });
      expect(result.proposal?.changes[0]).toMatchObject({
        operation: "add",
        proposal: {
          authority: "authoritative",
          provenance: [
            {
              projectId: ids.project,
              conversationId: ids.conversation,
              messageIds: [ids.message],
              actor: { type: "human", userId: ids.user },
            },
          ],
        },
      });
      expect(store.history.map((run) => run.status)).toEqual([
        "queued",
        "running",
        "running",
        "completed",
      ]);
    },
  );

  it("executes the research tool only after the manager selects research", async () => {
    const tool = new ConfigurableResearchTool({
      findings: [{ source: "https://example.com/spec", summary: "The public API is REST." }],
    });
    const { workflow, provider } = workflowWith([managerResponse("research"), deltaDraft()], tool);

    const result = await workflow.start(startInput());

    expect(result.run.status).toBe("completed");
    expect(tool.calls).toBe(1);
    expect(provider.requests[1]?.messages[1]?.content).toContain("https://example.com/spec");
  });

  it("builds update, supersede, and deprecate changes while gating deprecation", async () => {
    const { workflow } = workflowWith([managerResponse("merge"), allOperationsDraft()]);

    const result = await workflow.start(startInput());

    expect(result.run.status).toBe("awaiting_approval");
    expect(result.proposal?.changes.map((change) => change.operation)).toEqual([
      "update",
      "supersede",
      "deprecate",
    ]);
    expect(result.proposal?.changes[1]).toMatchObject({
      expectedBaseVersionId: "00000000-0000-4000-8000-000000000011",
      proposal: {
        explicitSupersedesVersionId: "00000000-0000-4000-8000-000000000011",
      },
    });
  });

  it("persists an invalid-output failure when supersession intent is inconsistent", async () => {
    const inconsistentSupersession = modelResponse({
      changes: [
        {
          operation: "supersede",
          targetLogicalItemId: ids.logicalItem,
          expectedBaseVersionId: ids.baseVersion,
          evidenceMessageIds: [ids.message],
          proposal: {
            kind: "task",
            key: "delivery.next_step",
            value: "Run validation",
            scope: { tags: ["delivery"] },
            confidence: 0.9,
            explicitSupersedesVersionId: null,
          },
        },
      ],
    });
    const { workflow } = workflowWith([managerResponse("merge"), inconsistentSupersession]);

    const result = await workflow.start(startInput());

    expect(result.run.status).toBe("failed");
    expect(agentWorkflowStateSchema.parse(result.run.state).failure).toMatchObject({
      code: "MODEL_OUTPUT_INVALID",
      stage: "specialist",
    });
  });

  it("pauses high-risk changes and resumes deterministically after owner approval", async () => {
    const { workflow, provider, store } = workflowWith([
      managerResponse("extractor"),
      deltaDraft("decision"),
    ]);
    const awaiting = await workflow.start(startInput());

    expect(awaiting.run.status).toBe("awaiting_approval");
    expect(awaiting.proposal).not.toBeNull();
    const resumed = await workflow.resume({
      projectId: ids.project,
      runId: awaiting.run.id,
      principal: { userId: ids.owner, role: "owner" },
      decision: "approve",
      rationale: "The evidence supports this accepted decision.",
    });

    expect(resumed.run.status).toBe("completed");
    expect(resumed.proposal).toEqual(awaiting.proposal);
    expect(provider.requests).toHaveLength(2);
    expect(agentWorkflowStateSchema.parse(resumed.run.state).approval).toMatchObject({
      decision: "approved",
      decidedBy: ids.owner,
    });
    expect(store.history.map((run) => run.status)).toEqual([
      "queued",
      "running",
      "running",
      "awaiting_approval",
      "completed",
    ]);
  });

  it("allows an editor to reject, but not approve, a high-risk proposal", async () => {
    const approvalCase = workflowWith([managerResponse("extractor"), deltaDraft("decision")]);
    const awaitingApproval = await approvalCase.workflow.start(startInput());

    await expect(
      approvalCase.workflow.resume({
        projectId: ids.project,
        runId: awaitingApproval.run.id,
        principal: { userId: ids.user, role: "editor" },
        decision: "approve",
        rationale: "Attempt approval",
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });

    const rejectionCase = workflowWith([managerResponse("extractor"), deltaDraft("decision")]);
    const awaitingRejection = await rejectionCase.workflow.start(startInput());
    const rejected = await rejectionCase.workflow.resume({
      projectId: ids.project,
      runId: awaitingRejection.run.id,
      principal: { userId: ids.user, role: "editor" },
      decision: "reject",
      rationale: "The evidence is insufficient.",
    });

    expect(rejected.run.status).toBe("cancelled");
    expect(rejected.proposal).toEqual(awaitingRejection.proposal);
    expect(agentWorkflowStateSchema.parse(rejected.run.state).approval?.decision).toBe("rejected");
  });

  it("supports explicit cancellation without changing the proposal", async () => {
    const { workflow } = workflowWith([managerResponse("extractor"), deltaDraft("decision")]);
    const awaiting = await workflow.start(startInput());

    const cancelled = await workflow.cancel({
      projectId: ids.project,
      runId: awaiting.run.id,
      principal: { userId: ids.user, role: "editor" },
      rationale: "The request is no longer needed.",
    });

    expect(cancelled.run.status).toBe("cancelled");
    expect(cancelled.proposal).toEqual(awaiting.proposal);
    expect(agentWorkflowStateSchema.parse(cancelled.run.state).cancellation).toMatchObject({
      cancelledBy: ids.user,
    });
    await expect(
      workflow.cancel({
        projectId: ids.project,
        runId: awaiting.run.id,
        principal: { userId: ids.user, role: "editor" },
        rationale: "Cancel twice",
      }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("does not let a stale model continuation overwrite a concurrent cancellation", async () => {
    const store = new MemoryRunStore();
    let releaseManager!: (response: ModelResponse) => void;
    let markStarted!: () => void;
    const managerStarted = new Promise<void>((resolve) => {
      markStarted = resolve;
    });
    const managerResponsePromise = new Promise<ModelResponse>((resolve) => {
      releaseManager = resolve;
    });
    const provider: ModelProvider = {
      async generate(): Promise<ModelResponse> {
        markStarted();
        return managerResponsePromise;
      },
      async *stream(): AsyncIterable<ModelStreamEvent> {
        throw new Error("Streaming is not used by the Agent workflow.");
      },
    };
    const workflow = new ContextDeltaAgentWorkflow(store, provider, new FixedRuntime());
    const starting = workflow.start(startInput());
    await managerStarted;
    const runId = store.history[0]?.id;
    if (runId === undefined) throw new Error("Expected the queued AgentRun to be persisted.");

    const cancelled = await workflow.cancel({
      projectId: ids.project,
      runId,
      principal: { userId: ids.user, role: "editor" },
      rationale: "Cancel while the manager request is in flight.",
    });
    releaseManager(managerResponse("extractor"));

    expect(cancelled.run.status).toBe("cancelled");
    await expect(starting).rejects.toMatchObject({ code: "CONFLICT" });
    await expect(
      workflow.get({
        projectId: ids.project,
        runId,
        principal: { userId: ids.user, role: "editor" },
      }),
    ).resolves.toMatchObject({ run: { status: "cancelled" } });
  });

  it("rejects viewer execution before persisting or calling a model", async () => {
    const { workflow, store, provider } = workflowWith([
      managerResponse("extractor"),
      deltaDraft(),
    ]);

    await expect(workflow.start(startInput("viewer"))).rejects.toBeInstanceOf(ApplicationError);
    expect(store.history).toHaveLength(0);
    expect(provider.requests).toHaveLength(0);
  });

  it("persists a sanitized failure when the manager model fails", async () => {
    const { workflow } = workflowWith([new Error("secret provider response")]);

    const result = await workflow.start(startInput());
    const state = agentWorkflowStateSchema.parse(result.run.state);

    expect(result.run.status).toBe("failed");
    expect(state.failure).toEqual({
      code: "MODEL_FAILURE",
      stage: "manager",
      message: "The model provider could not complete the AgentRun.",
    });
    expect(JSON.stringify(result.run.state)).not.toContain("secret provider response");
  });

  it.each([
    [modelResponse("not-json"), "MODEL_OUTPUT_INVALID"],
    [modelResponse({ specialty: "coding", reason: "Unsupported" }), "MODEL_OUTPUT_INVALID"],
    [modelResponse({ specialty: "extractor", reason: "Truncated" }, "length"), "MODEL_FAILURE"],
  ] as const)("persists %s manager response failures", async (response, expectedCode) => {
    const { workflow } = workflowWith([response]);

    const result = await workflow.start(startInput());

    expect(agentWorkflowStateSchema.parse(result.run.state).failure).toMatchObject({
      code: expectedCode,
      stage: "manager",
    });
  });

  it("persists a specialist provider failure after selection", async () => {
    const { workflow } = workflowWith([
      managerResponse("review"),
      new Error("private model error"),
    ]);

    const result = await workflow.start(startInput());

    expect(agentWorkflowStateSchema.parse(result.run.state).failure).toEqual({
      code: "MODEL_FAILURE",
      stage: "specialist",
      message: "The model provider could not complete the AgentRun.",
    });
  });

  it("persists model validation failure when output tries to inject authority", async () => {
    const injectedDraft = modelResponse({
      changes: [
        {
          operation: "add",
          evidenceMessageIds: [ids.message],
          proposal: {
            kind: "fact",
            key: "runtime.node",
            value: "Node.js 24",
            scope: { tags: [] },
            confidence: 1,
            authority: "authoritative",
            provenance: [],
            explicitSupersedesVersionId: null,
          },
        },
      ],
    });
    const { workflow } = workflowWith([managerResponse("extractor"), injectedDraft]);

    const result = await workflow.start(startInput());
    const state = agentWorkflowStateSchema.parse(result.run.state);

    expect(result.run.status).toBe("failed");
    expect(state.failure).toMatchObject({ code: "MODEL_OUTPUT_INVALID", stage: "specialist" });
    expect(result.proposal).toBeNull();
  });

  it("rejects citations outside the routed Conversation evidence", async () => {
    const unknownMessage = "00000000-0000-4000-8000-000000000099";
    const draft = deltaDraft();
    const parsedContent = JSON.parse(draft.content) as { changes: Array<Record<string, unknown>> };
    const firstChange = parsedContent.changes[0];
    if (firstChange !== undefined) {
      firstChange["evidenceMessageIds"] = [unknownMessage];
    }
    const { workflow } = workflowWith([managerResponse("review"), modelResponse(parsedContent)]);

    const result = await workflow.start(startInput());

    expect(result.run.status).toBe("failed");
    expect(agentWorkflowStateSchema.parse(result.run.state).failure).toMatchObject({
      code: "MODEL_OUTPUT_INVALID",
      stage: "specialist",
    });
  });

  it("persists tool failure and never invokes the research specialist model", async () => {
    const tool = new ConfigurableResearchTool(new Error("private tool failure"));
    const { workflow, provider } = workflowWith([managerResponse("research"), deltaDraft()], tool);

    const result = await workflow.start(startInput());
    const state = agentWorkflowStateSchema.parse(result.run.state);

    expect(result.run.status).toBe("failed");
    expect(state.failure).toEqual({
      code: "TOOL_FAILURE",
      stage: "research_tool",
      message: "The selected Agent tool could not complete its operation.",
    });
    expect(provider.requests).toHaveLength(1);
    expect(JSON.stringify(result.run.state)).not.toContain("private tool failure");
  });

  it("validates research tool output before giving it to a model", async () => {
    const tool = new ConfigurableResearchTool({
      findings: [{ source: "not-a-url", summary: "Untrusted finding" }],
    });
    const { workflow, provider } = workflowWith([managerResponse("research")], tool);

    const result = await workflow.start(startInput());

    expect(agentWorkflowStateSchema.parse(result.run.state).failure).toEqual({
      code: "TOOL_OUTPUT_INVALID",
      stage: "research_tool",
      message: "The selected Agent tool returned invalid output.",
    });
    expect(provider.requests).toHaveLength(1);
  });

  it("fails safely when research is selected without a configured tool", async () => {
    const { workflow } = workflowWith([managerResponse("research")]);

    const result = await workflow.start(startInput());

    expect(agentWorkflowStateSchema.parse(result.run.state).failure).toMatchObject({
      code: "TOOL_UNAVAILABLE",
      stage: "research_tool",
    });
  });

  it("allows project viewers to inspect a scoped run but hides other projects as not found", async () => {
    const { workflow } = workflowWith([managerResponse("extractor"), deltaDraft()]);
    const completed = await workflow.start(startInput());

    const found = await workflow.get({
      projectId: ids.project,
      runId: completed.run.id,
      principal: { userId: ids.owner, role: "viewer" },
    });
    expect(found.run.id).toBe(completed.run.id);

    await expect(
      workflow.get({
        projectId: projectIdSchema.parse("00000000-0000-4000-8000-000000000099"),
        runId: completed.run.id,
        principal: { userId: ids.owner, role: "viewer" },
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("validates evidence uniqueness and sequence boundaries before persistence", () => {
    const input = startInput();
    expect(
      startAgentWorkflowInputSchema.safeParse({
        ...input,
        evidence: [input.evidence[0], input.evidence[0]],
      }).success,
    ).toBe(false);
    expect(
      startAgentWorkflowInputSchema.safeParse({
        ...input,
        evidence: [{ ...input.evidence[0], sequence: 2 }],
      }).success,
    ).toBe(false);
    expect(
      agentDeltaDraftSchema.safeParse({
        changes: [
          {
            operation: "deprecate",
            targetLogicalItemId: ids.logicalItem,
            expectedBaseVersionId: ids.baseVersion,
            evidenceMessageIds: [ids.message, ids.message],
          },
        ],
      }).success,
    ).toBe(false);
  });

  it("rejects internally inconsistent persisted workflow states", async () => {
    const { workflow } = workflowWith([managerResponse("extractor"), deltaDraft()]);
    const completed = await workflow.start(startInput());
    const valid = agentWorkflowStateSchema.parse(completed.run.state);
    const failure = {
      code: "MODEL_FAILURE",
      stage: "manager",
      message: "Safe failure",
    } as const;
    const approval = {
      decision: "approved",
      decidedBy: ids.owner,
      rationale: "Approved",
      decidedAt: "2026-08-23T00:00:00.000Z",
    } as const;

    expect(agentWorkflowStateSchema.safeParse({ ...valid, failure }).success).toBe(false);
    expect(
      agentWorkflowStateSchema.safeParse({
        ...valid,
        phase: "cancelled",
        cancellation: null,
        approval: null,
      }).success,
    ).toBe(false);
    expect(agentWorkflowStateSchema.safeParse({ ...valid, selectedSpecialty: null }).success).toBe(
      false,
    );
    expect(agentWorkflowStateSchema.safeParse({ ...valid, proposal: null }).success).toBe(false);
    expect(
      agentWorkflowStateSchema.safeParse({
        ...valid,
        phase: "awaiting_approval",
        approvalRequired: false,
      }).success,
    ).toBe(false);
    expect(
      agentWorkflowStateSchema.safeParse({
        ...valid,
        approvalRequired: false,
        approval,
      }).success,
    ).toBe(false);
  });
});
