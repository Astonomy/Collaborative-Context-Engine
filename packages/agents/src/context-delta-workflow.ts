import {
  ApplicationError,
  hasProjectPermission,
  type ModelProvider,
  type ModelResponse,
  type RunRepository,
  type StructuredResponseFormat,
} from "@cce/application";
import {
  agentRunIdSchema,
  agentRunSchema,
  contextDeltaIdSchema,
  contextDeltaSchema,
  contextItemVersionIdSchema,
  deltaChangeIdSchema,
  isHighRiskContextKind,
  type AgentRun,
  type ContextDelta,
  type ContextDeltaChange,
  type Provenance,
} from "@cce/domain";
import { z, ZodError } from "zod";

import {
  agentDeltaDraftSchema,
  agentWorkflowStateSchema,
  cancelAgentWorkflowInputSchema,
  getAgentWorkflowInputSchema,
  managerSelectionSchema,
  researchToolResultSchema,
  resumeAgentWorkflowInputSchema,
  startAgentWorkflowInputSchema,
  type AgentDeltaDraft,
  type AgentDeltaDraftChange,
  type AgentSpecialty,
  type AgentWorkflowFailureCode,
  type AgentWorkflowState,
  type CancelAgentWorkflowInput,
  type GetAgentWorkflowInput,
  type ResearchToolResult,
  type ResumeAgentWorkflowInput,
  type StartAgentWorkflowInput,
  type WorkflowEvidence,
} from "./workflow-contracts";

export interface AgentRunMutationAuthorization {
  readonly userId: StartAgentWorkflowInput["principal"]["userId"];
  readonly permission: Parameters<typeof hasProjectPermission>[1];
}

export interface AgentWorkflowRunStore {
  insertAgentRun(run: AgentRun, authorization: AgentRunMutationAuthorization): Promise<void>;
  updateAgentRun(
    run: AgentRun,
    expectedVersion: number,
    authorization: AgentRunMutationAuthorization,
  ): Promise<boolean>;
  findAgentRun: RunRepository["findAgentRun"];
}

export interface AgentWorkflowRuntime {
  readonly ids: { next(): string };
  readonly clock: { now(): Date };
  readonly contentHasher: { sha256(value: string): string };
}

export interface ResearchTool {
  research(input: {
    readonly projectId: StartAgentWorkflowInput["projectId"];
    readonly conversationId: StartAgentWorkflowInput["conversationId"];
    readonly objective: string;
    readonly routedContext: string;
    readonly signal?: AbortSignal;
  }): Promise<unknown>;
}

export interface AgentWorkflowResult {
  readonly run: AgentRun;
  readonly proposal: ContextDelta | null;
}

type FailureStage = NonNullable<AgentWorkflowState["failure"]>["stage"];

class AgentExecutionFailure extends Error {
  public constructor(
    public readonly code: AgentWorkflowFailureCode,
    public readonly stage: FailureStage,
    message: string,
  ) {
    super(message);
    this.name = "AgentExecutionFailure";
  }
}

const managerResponseFormat: StructuredResponseFormat = {
  name: "cce_agent_specialty_selection",
  strict: true,
  schema: z.json().parse(z.toJSONSchema(managerSelectionSchema)),
};

const deltaDraftResponseFormat: StructuredResponseFormat = {
  name: "cce_agent_context_delta_draft",
  strict: true,
  schema: z.json().parse(z.toJSONSchema(agentDeltaDraftSchema)),
};

const allowedRunTransitions: Readonly<Record<AgentRun["status"], readonly AgentRun["status"][]>> = {
  queued: ["running", "cancelled"],
  running: ["running", "awaiting_approval", "completed", "failed", "cancelled"],
  awaiting_approval: ["completed", "cancelled"],
  completed: [],
  failed: [],
  cancelled: [],
};

const expectedStatusByPhase: Readonly<Record<AgentWorkflowState["phase"], AgentRun["status"]>> = {
  queued: "queued",
  selecting: "running",
  executing: "running",
  awaiting_approval: "awaiting_approval",
  completed: "completed",
  failed: "failed",
  cancelled: "cancelled",
};

function parseModelJson(response: ModelResponse, stage: FailureStage): unknown {
  if (response.finishReason !== "stop") {
    throw new AgentExecutionFailure(
      "MODEL_FAILURE",
      stage,
      "The model did not complete the requested structured response.",
    );
  }
  try {
    return JSON.parse(response.content) as unknown;
  } catch {
    throw new AgentExecutionFailure(
      "MODEL_OUTPUT_INVALID",
      stage,
      "The model returned malformed JSON.",
    );
  }
}

function resultFromRun(run: AgentRun): AgentWorkflowResult {
  const state = parseWorkflowRunState(run);
  return { run, proposal: state.proposal };
}

function parseWorkflowRunState(run: AgentRun): AgentWorkflowState {
  if (run.agentName !== "manager") {
    throw new ApplicationError("CONFLICT", "The AgentRun is not managed by this workflow.");
  }
  const parsed = agentWorkflowStateSchema.safeParse(run.state);
  if (!parsed.success || expectedStatusByPhase[parsed.data.phase] !== run.status) {
    throw new ApplicationError("CONFLICT", "The persisted AgentRun state is invalid.");
  }
  return parsed.data;
}

function initialState(input: StartAgentWorkflowInput): AgentWorkflowState {
  return agentWorkflowStateSchema.parse({
    schemaVersion: 1,
    phase: "queued",
    request: {
      conversationId: input.conversationId,
      branchId: input.branchId,
      baseCommitId: input.baseCommitId,
      throughMessageSequence: input.throughMessageSequence,
      objective: input.objective,
      requestedBy: input.principal.userId,
    },
    selectedSpecialty: null,
    selectionReason: null,
    proposal: null,
    approvalRequired: false,
    approval: null,
    cancellation: null,
    failure: null,
  });
}

function withPhase(
  state: AgentWorkflowState,
  input: Partial<AgentWorkflowState> & Pick<AgentWorkflowState, "phase">,
): AgentWorkflowState {
  return agentWorkflowStateSchema.parse({ ...state, ...input });
}

function requiresHumanApproval(
  changes: readonly ContextDeltaChange[],
  currentItems: StartAgentWorkflowInput["currentItems"],
): boolean {
  const currentByLogicalId = new Map(
    currentItems.map((item) => [item.logicalItemId, item] as const),
  );
  return changes.some((change) => {
    if (change.operation === "deprecate") {
      return true;
    }
    if (isHighRiskContextKind(change.proposal.kind)) {
      return true;
    }
    if (change.operation === "add") {
      return false;
    }
    const current = currentByLogicalId.get(change.targetLogicalItemId);
    return current === undefined || isHighRiskContextKind(current.kind);
  });
}

function safeFailureMessage(code: AgentWorkflowFailureCode): string {
  switch (code) {
    case "MODEL_FAILURE":
      return "The model provider could not complete the AgentRun.";
    case "MODEL_OUTPUT_INVALID":
      return "The model returned an invalid Agent proposal.";
    case "TOOL_UNAVAILABLE":
      return "The selected Agent tool is not configured.";
    case "TOOL_FAILURE":
      return "The selected Agent tool could not complete its operation.";
    case "TOOL_OUTPUT_INVALID":
      return "The selected Agent tool returned invalid output.";
  }
}

export class ContextDeltaAgentWorkflow {
  public constructor(
    private readonly store: AgentWorkflowRunStore,
    private readonly modelProvider: ModelProvider,
    private readonly runtime: AgentWorkflowRuntime,
    private readonly researchTool: ResearchTool | null = null,
  ) {}

  public async start(
    untrustedInput: StartAgentWorkflowInput,
    signal?: AbortSignal,
  ): Promise<AgentWorkflowResult> {
    const input = startAgentWorkflowInputSchema.parse(untrustedInput);
    this.requirePermission(input.principal.role, "agent:run");

    const now = this.runtime.clock.now().toISOString();
    const run = agentRunSchema.parse({
      id: agentRunIdSchema.parse(this.runtime.ids.next()),
      projectId: input.projectId,
      agentName: "manager",
      status: "queued",
      version: 0,
      state: initialState(input),
      createdAt: now,
      updatedAt: now,
    });
    const executionAuthorization = {
      userId: input.principal.userId,
      permission: "agent:run" as const,
    };
    await this.store.insertAgentRun(run, executionAuthorization);

    let current = await this.transition(
      run,
      "running",
      withPhase(parseWorkflowRunState(run), { phase: "selecting" }),
      executionAuthorization,
    );

    let selection: { readonly specialty: AgentSpecialty; readonly reason: string };
    try {
      selection = await this.selectSpecialty(input, signal);
    } catch (error) {
      return this.persistExecutionFailure(current, error, "manager", executionAuthorization);
    }

    current = await this.transition(
      current,
      "running",
      withPhase(parseWorkflowRunState(current), {
        phase: "executing",
        selectedSpecialty: selection.specialty,
        selectionReason: selection.reason,
      }),
      executionAuthorization,
    );

    let research: ResearchToolResult | null = null;
    if (selection.specialty === "research") {
      try {
        research = await this.executeResearchTool(input, signal);
      } catch (error) {
        return this.persistExecutionFailure(
          current,
          error,
          "research_tool",
          executionAuthorization,
        );
      }
    }

    let draft: AgentDeltaDraft;
    try {
      draft = await this.generateDeltaDraft(input, selection.specialty, research, signal);
    } catch (error) {
      return this.persistExecutionFailure(current, error, "specialist", executionAuthorization);
    }

    let proposal: ContextDelta;
    try {
      proposal = this.buildDelta(input, current.id, selection.specialty, draft);
    } catch (error) {
      if (error instanceof AgentExecutionFailure) {
        return this.persistExecutionFailure(current, error, "specialist", executionAuthorization);
      }
      if (error instanceof ZodError) {
        return this.persistExecutionFailure(
          current,
          new AgentExecutionFailure(
            "MODEL_OUTPUT_INVALID",
            "specialist",
            "The model proposal violates ContextDelta invariants.",
          ),
          "specialist",
          executionAuthorization,
        );
      }
      throw error;
    }

    const approvalRequired = requiresHumanApproval(proposal.changes, input.currentItems);
    const terminalPhase = approvalRequired ? "awaiting_approval" : "completed";
    const terminalStatus = approvalRequired ? "awaiting_approval" : "completed";
    const completed = await this.transition(
      current,
      terminalStatus,
      withPhase(parseWorkflowRunState(current), {
        phase: terminalPhase,
        proposal,
        approvalRequired,
      }),
      executionAuthorization,
    );
    return resultFromRun(completed);
  }

  public async get(untrustedInput: GetAgentWorkflowInput): Promise<AgentWorkflowResult> {
    const input = getAgentWorkflowInputSchema.parse(untrustedInput);
    this.requirePermission(input.principal.role, "project:read");
    return resultFromRun(await this.findRun(input.projectId, input.runId));
  }

  public async resume(untrustedInput: ResumeAgentWorkflowInput): Promise<AgentWorkflowResult> {
    const input = resumeAgentWorkflowInputSchema.parse(untrustedInput);
    this.requirePermission(
      input.principal.role,
      input.decision === "approve" ? "context:approve_high_risk" : "context:review_low_risk",
    );
    const run = await this.findRun(input.projectId, input.runId);
    const state = parseWorkflowRunState(run);
    if (run.status !== "awaiting_approval" || state.proposal === null) {
      throw new ApplicationError("CONFLICT", "Only an awaiting AgentRun can be resumed.");
    }
    const now = this.runtime.clock.now().toISOString();
    const approved = input.decision === "approve";
    const nextState = withPhase(state, {
      phase: approved ? "completed" : "cancelled",
      approval: {
        decision: approved ? "approved" : "rejected",
        decidedBy: input.principal.userId,
        rationale: input.rationale,
        decidedAt: now,
      },
    });
    const updated = await this.transition(run, approved ? "completed" : "cancelled", nextState, {
      userId: input.principal.userId,
      permission: approved ? "context:approve_high_risk" : "context:review_low_risk",
    });
    return resultFromRun(updated);
  }

  public async cancel(untrustedInput: CancelAgentWorkflowInput): Promise<AgentWorkflowResult> {
    const input = cancelAgentWorkflowInputSchema.parse(untrustedInput);
    this.requirePermission(input.principal.role, "agent:run");
    const run = await this.findRun(input.projectId, input.runId);
    const state = parseWorkflowRunState(run);
    if (!["queued", "running", "awaiting_approval"].includes(run.status)) {
      throw new ApplicationError("CONFLICT", "A terminal AgentRun cannot be cancelled.");
    }
    const now = this.runtime.clock.now().toISOString();
    const nextState = withPhase(state, {
      phase: "cancelled",
      cancellation: {
        cancelledBy: input.principal.userId,
        rationale: input.rationale,
        cancelledAt: now,
      },
    });
    return resultFromRun(
      await this.transition(run, "cancelled", nextState, {
        userId: input.principal.userId,
        permission: "agent:run",
      }),
    );
  }

  private requirePermission(
    role: StartAgentWorkflowInput["principal"]["role"],
    permission: Parameters<typeof hasProjectPermission>[1],
  ): void {
    if (!hasProjectPermission(role, permission)) {
      throw new ApplicationError("FORBIDDEN", `The ${role} role does not grant ${permission}.`);
    }
  }

  private async selectSpecialty(
    input: StartAgentWorkflowInput,
    signal?: AbortSignal,
  ): Promise<{ readonly specialty: AgentSpecialty; readonly reason: string }> {
    let response: ModelResponse;
    try {
      response = await this.modelProvider.generate({
        profile: "small",
        purpose: "agent",
        promptId: "cce.agent.manager.select-specialty",
        promptVersion: 1,
        temperature: 0,
        responseFormat: managerResponseFormat,
        messages: [
          {
            role: "system",
            content:
              "Select exactly one CCE proposal specialty. Never authorize or commit project context.",
          },
          {
            role: "user",
            content: JSON.stringify({
              objective: input.objective,
              throughMessageSequence: input.throughMessageSequence,
            }),
          },
        ],
        ...(signal === undefined ? {} : { signal }),
      });
    } catch {
      throw new AgentExecutionFailure(
        "MODEL_FAILURE",
        "manager",
        "The manager model request failed.",
      );
    }
    const parsed = managerSelectionSchema.safeParse(parseModelJson(response, "manager"));
    if (!parsed.success) {
      throw new AgentExecutionFailure(
        "MODEL_OUTPUT_INVALID",
        "manager",
        "The manager returned an invalid specialty selection.",
      );
    }
    return parsed.data;
  }

  private async executeResearchTool(
    input: StartAgentWorkflowInput,
    signal?: AbortSignal,
  ): Promise<ResearchToolResult> {
    if (this.researchTool === null) {
      throw new AgentExecutionFailure(
        "TOOL_UNAVAILABLE",
        "research_tool",
        "No research tool is configured.",
      );
    }
    let output: unknown;
    try {
      output = await this.researchTool.research({
        projectId: input.projectId,
        conversationId: input.conversationId,
        objective: input.objective,
        routedContext: input.routedContext,
        ...(signal === undefined ? {} : { signal }),
      });
    } catch {
      throw new AgentExecutionFailure(
        "TOOL_FAILURE",
        "research_tool",
        "The research tool request failed.",
      );
    }
    const parsed = researchToolResultSchema.safeParse(output);
    if (!parsed.success) {
      throw new AgentExecutionFailure(
        "TOOL_OUTPUT_INVALID",
        "research_tool",
        "The research tool returned invalid findings.",
      );
    }
    return parsed.data;
  }

  private async generateDeltaDraft(
    input: StartAgentWorkflowInput,
    specialty: AgentSpecialty,
    research: ResearchToolResult | null,
    signal?: AbortSignal,
  ): Promise<AgentDeltaDraft> {
    let response: ModelResponse;
    try {
      response = await this.modelProvider.generate({
        profile: specialty === "merge" || specialty === "review" ? "large" : "medium",
        purpose: "agent",
        promptId: `cce.agent.${specialty}.propose-delta`,
        promptVersion: 1,
        temperature: 0,
        responseFormat: deltaDraftResponseFormat,
        messages: [
          {
            role: "system",
            content:
              "Return only a ContextDelta change draft. Cite supplied message IDs. Do not emit project IDs, actors, provenance, authority, approvals, statuses, commits, or change IDs.",
          },
          {
            role: "user",
            content: JSON.stringify({
              objective: input.objective,
              routedContext: input.routedContext,
              evidence: input.evidence.map((evidence) => ({
                messageId: evidence.messageId,
                sequence: evidence.sequence,
              })),
              research,
            }),
          },
        ],
        ...(signal === undefined ? {} : { signal }),
      });
    } catch {
      throw new AgentExecutionFailure(
        "MODEL_FAILURE",
        "specialist",
        "The specialist model request failed.",
      );
    }
    const parsed = agentDeltaDraftSchema.safeParse(parseModelJson(response, "specialist"));
    if (!parsed.success) {
      throw new AgentExecutionFailure(
        "MODEL_OUTPUT_INVALID",
        "specialist",
        "The specialist returned an invalid ContextDelta draft.",
      );
    }
    return parsed.data;
  }

  private buildDelta(
    input: StartAgentWorkflowInput,
    runId: AgentRun["id"],
    specialty: AgentSpecialty,
    draft: AgentDeltaDraft,
  ): ContextDelta {
    const createdAt = this.runtime.clock.now().toISOString();
    const changes = draft.changes.map((change) => this.buildChange(input, change, createdAt));
    return contextDeltaSchema.parse({
      id: contextDeltaIdSchema.parse(this.runtime.ids.next()),
      projectId: input.projectId,
      branchId: input.branchId,
      conversationId: input.conversationId,
      baseCommitId: input.baseCommitId,
      throughMessageSequence: input.throughMessageSequence,
      schemaVersion: 1,
      extractorRunId: null,
      revisionOf: null,
      contentHash: this.runtime.contentHasher.sha256(JSON.stringify(changes)),
      proposedBy: { type: "agent", agentName: specialty, runId },
      createdAt,
      changes,
    });
  }

  private buildChange(
    input: StartAgentWorkflowInput,
    draft: AgentDeltaDraftChange,
    recordedAt: string,
  ): ContextDeltaChange {
    const provenance = this.buildProvenance(input, draft.evidenceMessageIds, recordedAt);
    const id = deltaChangeIdSchema.parse(this.runtime.ids.next());
    switch (draft.operation) {
      case "add":
        return {
          id,
          operation: "add",
          proposal: { ...draft.proposal, authority: "authoritative", provenance },
        };
      case "update":
        return {
          id,
          operation: "update",
          targetLogicalItemId: draft.targetLogicalItemId,
          expectedBaseVersionId: contextItemVersionIdSchema.parse(draft.expectedBaseVersionId),
          proposal: { ...draft.proposal, authority: "authoritative", provenance },
        };
      case "supersede":
        return {
          id,
          operation: "supersede",
          targetLogicalItemId: draft.targetLogicalItemId,
          expectedBaseVersionId: contextItemVersionIdSchema.parse(draft.expectedBaseVersionId),
          proposal: { ...draft.proposal, authority: "authoritative", provenance },
        };
      case "deprecate":
        return {
          id,
          operation: "deprecate",
          targetLogicalItemId: draft.targetLogicalItemId,
          expectedBaseVersionId: contextItemVersionIdSchema.parse(draft.expectedBaseVersionId),
          provenance,
        };
    }
  }

  private buildProvenance(
    input: StartAgentWorkflowInput,
    messageIds: readonly WorkflowEvidence["messageId"][],
    recordedAt: string,
  ): Provenance[] {
    const evidenceById = new Map(
      input.evidence.map((evidence) => [evidence.messageId, evidence] as const),
    );
    return messageIds.map((messageId) => {
      const evidence = evidenceById.get(messageId);
      if (evidence === undefined) {
        throw new AgentExecutionFailure(
          "MODEL_OUTPUT_INVALID",
          "specialist",
          "The specialist cited unknown evidence.",
        );
      }
      return {
        projectId: input.projectId,
        conversationId: input.conversationId,
        messageIds: [messageId],
        actor: evidence.actor,
        modelRunId: null,
        recordedAt,
      };
    });
  }

  private async persistExecutionFailure(
    run: AgentRun,
    error: unknown,
    fallbackStage: FailureStage,
    authorization: AgentRunMutationAuthorization,
  ): Promise<AgentWorkflowResult> {
    const failure =
      error instanceof AgentExecutionFailure
        ? error
        : new AgentExecutionFailure("MODEL_FAILURE", fallbackStage, "Agent execution failed.");
    const state = withPhase(parseWorkflowRunState(run), {
      phase: "failed",
      failure: {
        code: failure.code,
        stage: failure.stage,
        message: safeFailureMessage(failure.code),
      },
    });
    return resultFromRun(await this.transition(run, "failed", state, authorization));
  }

  private async findRun(
    projectId: GetAgentWorkflowInput["projectId"],
    runId: GetAgentWorkflowInput["runId"],
  ): Promise<AgentRun> {
    const run = await this.store.findAgentRun(projectId, runId);
    if (run === null) {
      throw new ApplicationError("NOT_FOUND", "The AgentRun was not found.");
    }
    return run;
  }

  private async transition(
    current: AgentRun,
    nextStatus: AgentRun["status"],
    nextState: AgentWorkflowState,
    authorization: AgentRunMutationAuthorization,
  ): Promise<AgentRun> {
    if (!allowedRunTransitions[current.status].includes(nextStatus)) {
      throw new ApplicationError(
        "CONFLICT",
        `AgentRun cannot transition from ${current.status} to ${nextStatus}.`,
      );
    }
    if (expectedStatusByPhase[nextState.phase] !== nextStatus) {
      throw new ApplicationError("CONFLICT", "AgentRun status and workflow phase do not match.");
    }
    const updated = agentRunSchema.parse({
      ...current,
      status: nextStatus,
      version: current.version + 1,
      state: nextState,
      updatedAt: this.runtime.clock.now().toISOString(),
    });
    const saved = await this.store.updateAgentRun(updated, current.version, authorization);
    if (!saved) {
      throw new ApplicationError(
        "CONFLICT",
        "The AgentRun changed concurrently; reload it before retrying the transition.",
      );
    }
    return updated;
  }
}
