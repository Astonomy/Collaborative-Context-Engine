import {
  ApplicationError,
  ContextService,
  authorizeProjectMember,
  requireActiveProject,
  type ModelProvider,
  type ProjectPermission,
  type UnitOfWork,
} from "@cce/application";
import {
  auditEventIdSchema,
  type AgentRunId,
  type ConversationId,
  type ProjectId,
  type UserId,
} from "@cce/domain";

import {
  ContextDeltaAgentWorkflow,
  type AgentWorkflowResult,
  type AgentWorkflowRuntime,
  type ResearchTool,
} from "./context-delta-workflow";
import { agentWorkflowStateSchema } from "./workflow-contracts";

/**
 * Server-side scope adapter for the Agent workflow. It derives every trusted
 * project, Branch, evidence, principal, and routed-context field from CCE
 * repositories rather than accepting those values from an HTTP client.
 */
export class ScopedAgentService {
  private readonly workflow: ContextDeltaAgentWorkflow;

  public constructor(
    private readonly unitOfWork: UnitOfWork,
    private readonly contexts: ContextService,
    modelProvider: ModelProvider,
    private readonly runtime: AgentWorkflowRuntime,
    researchTool: ResearchTool | null = null,
  ) {
    this.workflow = new ContextDeltaAgentWorkflow(
      {
        insertAgentRun: (run, authorization) =>
          this.unitOfWork.run(async (repositories) => {
            const access = await repositories.projects.findAccess(
              run.projectId,
              authorization.userId,
            );
            authorizeProjectMember(
              access?.member ?? null,
              authorization.userId,
              authorization.permission,
            );
            if (access === null) {
              throw new ApplicationError("NOT_FOUND", "Project was not found.");
            }
            requireActiveProject(access.project);
            await repositories.runs.insertAgentRun(run);
          }),
        updateAgentRun: (run, expectedVersion, authorization) =>
          this.unitOfWork.run(async (repositories) => {
            const access = await repositories.projects.findAccess(
              run.projectId,
              authorization.userId,
            );
            authorizeProjectMember(
              access?.member ?? null,
              authorization.userId,
              authorization.permission,
            );
            if (access === null) {
              throw new ApplicationError("NOT_FOUND", "Project was not found.");
            }
            requireActiveProject(access.project);
            return repositories.runs.updateAgentRun(run, expectedVersion);
          }),
        findAgentRun: (projectId, runId) =>
          this.unitOfWork.run((repositories) =>
            repositories.runs.findAgentRun(projectId, runId),
          ),
      },
      modelProvider,
      runtime,
      researchTool,
    );
  }

  public async start(input: {
    readonly projectId: ProjectId;
    readonly conversationId: ConversationId;
    readonly throughMessageSequence: number;
    readonly objective: string;
    readonly actorUserId: UserId;
    readonly signal?: AbortSignal;
  }): Promise<AgentWorkflowResult> {
    if (
      !Number.isInteger(input.throughMessageSequence) ||
      input.throughMessageSequence < 0 ||
      input.throughMessageSequence > 2_147_483_647
    ) {
      throw new ApplicationError(
        "VALIDATION",
        "throughMessageSequence must be a PostgreSQL-safe non-negative integer.",
      );
    }
    const scoped = await this.unitOfWork.run(async (repositories) => {
      const access = await repositories.projects.findAccess(input.projectId, input.actorUserId);
      authorizeProjectMember(access?.member ?? null, input.actorUserId, "agent:run");
      if (access === null) {
        throw new ApplicationError("NOT_FOUND", "Project was not found.");
      }
      requireActiveProject(access.project);
      const conversation = await repositories.conversations.find(
        input.projectId,
        input.conversationId,
      );
      if (conversation === null || conversation.status !== "active") {
        throw new ApplicationError("NOT_FOUND", "Active conversation was not found.");
      }
      const branch = await repositories.conversations.findBranch(
        input.projectId,
        conversation.branchId,
      );
      if (branch === null || branch.status !== "open") {
        throw new ApplicationError("CONFLICT", "Conversation Branch is not open.");
      }
      const messages = await repositories.conversations.listMessages(
        input.projectId,
        input.conversationId,
      );
      const evidence = messages
        .filter(
          (message) =>
            message.deliveryState === "completed" &&
            message.sequence <= input.throughMessageSequence,
        )
        .map((message) => ({
          messageId: message.id,
          sequence: message.sequence,
          actor: message.author,
        }));
      if (evidence.length === 0) {
        throw new ApplicationError(
          "VALIDATION",
          "An AgentRun requires completed Conversation evidence in the requested range.",
        );
      }
      const currentItems = await repositories.context.listCurrentItems(input.projectId);
      const actualThroughMessageSequence = Math.max(
        ...evidence.map((item) => item.sequence),
      );
      return { access, branch, evidence, currentItems, actualThroughMessageSequence };
    });
    const pack = await this.contexts.buildForConversation({
      projectId: input.projectId,
      conversationId: input.conversationId,
      actorUserId: input.actorUserId,
    });
    const result = await this.workflow.start({
      projectId: input.projectId,
      conversationId: input.conversationId,
      branchId: scoped.branch.id,
      baseCommitId: scoped.branch.baseCommitId,
      throughMessageSequence: scoped.actualThroughMessageSequence,
      objective: input.objective,
      routedContext: JSON.stringify(pack),
      evidence: scoped.evidence,
      currentItems: [...scoped.currentItems],
      principal: { userId: input.actorUserId, role: scoped.access.member.role },
    }, input.signal);
    await this.recordOutcome("agent_run.started", input.actorUserId, result, [
      "agent:run",
      "context:propose",
    ]);
    return result;
  }

  public async get(input: {
    readonly projectId: ProjectId;
    readonly runId: AgentRunId;
    readonly actorUserId: UserId;
  }): Promise<AgentWorkflowResult> {
    const role = await this.projectRole(input.projectId, input.actorUserId, "project:read");
    return this.workflow.get({
      projectId: input.projectId,
      runId: input.runId,
      principal: { userId: input.actorUserId, role },
    });
  }

  public async reconcile(input: {
    readonly projectId: ProjectId;
    readonly runId: AgentRunId;
    readonly actorUserId: UserId;
  }): Promise<AgentWorkflowResult> {
    const role = await this.unitOfWork.run(async (repositories) => {
      const access = await repositories.projects.findAccess(input.projectId, input.actorUserId);
      const member = authorizeProjectMember(
        access?.member ?? null,
        input.actorUserId,
        "agent:run",
      );
      authorizeProjectMember(access?.member ?? null, input.actorUserId, "context:propose");
      if (access === null) {
        throw new ApplicationError("NOT_FOUND", "Project was not found.");
      }
      requireActiveProject(access.project);
      return member.role;
    });
    const result = await this.workflow.get({
      projectId: input.projectId,
      runId: input.runId,
      principal: { userId: input.actorUserId, role },
    });
    if (result.run.status !== "completed" || result.proposal === null) {
      throw new ApplicationError(
        "CONFLICT",
        "Only a completed AgentRun proposal can be reconciled.",
      );
    }
    await this.recordOutcome(
      "agent_run.reconciled",
      input.actorUserId,
      result,
      ["agent:run", "context:propose"],
      true,
    );
    return result;
  }

  public async list(input: {
    readonly projectId: ProjectId;
    readonly actorUserId: UserId;
    readonly status?: "queued" | "running" | "awaiting_approval" | "completed" | "failed" | "cancelled";
  }) {
    return this.unitOfWork.run(async (repositories) => {
      const access = await repositories.projects.findAccess(input.projectId, input.actorUserId);
      authorizeProjectMember(access?.member ?? null, input.actorUserId, "project:read");
      const runs = await repositories.runs.listAgentRuns(input.projectId);
      return input.status === undefined
        ? runs
        : runs.filter((run) => run.status === input.status);
    });
  }

  public async resume(input: {
    readonly projectId: ProjectId;
    readonly runId: AgentRunId;
    readonly actorUserId: UserId;
    readonly decision: "approve" | "reject";
    readonly rationale: string;
  }): Promise<AgentWorkflowResult> {
    const role = await this.projectRole(input.projectId, input.actorUserId, "project:read", true);
    const existing = await this.workflow.get({
      projectId: input.projectId,
      runId: input.runId,
      principal: { userId: input.actorUserId, role },
    });
    const existingState = agentWorkflowStateSchema.parse(existing.run.state);
    if (
      input.decision === "approve" &&
      existing.run.status === "completed" &&
      existingState.approval?.decision === "approved"
    ) {
      await this.recordOutcome(
        "agent_run.reconciled",
        input.actorUserId,
        existing,
        ["context:approve_high_risk", "context:propose"],
        true,
      );
      return existing;
    }
    if (
      input.decision === "reject" &&
      existing.run.status === "cancelled" &&
      existingState.approval?.decision === "rejected"
    ) {
      return existing;
    }
    const result = await this.workflow.resume({
      projectId: input.projectId,
      runId: input.runId,
      decision: input.decision,
      rationale: input.rationale,
      principal: { userId: input.actorUserId, role },
    });
    await this.recordOutcome(
      "agent_run.resumed",
      input.actorUserId,
      result,
      input.decision === "approve"
        ? ["context:approve_high_risk", "context:propose"]
        : ["context:review_low_risk"],
    );
    return result;
  }

  public async cancel(input: {
    readonly projectId: ProjectId;
    readonly runId: AgentRunId;
    readonly actorUserId: UserId;
    readonly rationale: string;
  }): Promise<AgentWorkflowResult> {
    const role = await this.projectRole(input.projectId, input.actorUserId, "project:read", true);
    const result = await this.workflow.cancel({
      projectId: input.projectId,
      runId: input.runId,
      rationale: input.rationale,
      principal: { userId: input.actorUserId, role },
    });
    await this.recordOutcome("agent_run.cancelled", input.actorUserId, result, ["agent:run"]);
    return result;
  }

  private async projectRole(
    projectId: ProjectId,
    actorUserId: UserId,
    permission: ProjectPermission,
    activeRequired = false,
  ) {
    return this.unitOfWork.run(async (repositories) => {
      const access = await repositories.projects.findAccess(projectId, actorUserId);
      const member = authorizeProjectMember(access?.member ?? null, actorUserId, permission);
      if (activeRequired) {
        if (access === null) {
          throw new ApplicationError("NOT_FOUND", "Project was not found.");
        }
        requireActiveProject(access.project);
      }
      return member.role;
    });
  }

  private async recordOutcome(
    action: string,
    actorUserId: UserId,
    result: AgentWorkflowResult,
    requiredPermissions: readonly ProjectPermission[],
    auditOnlyWhenProposalPersisted = false,
  ): Promise<void> {
    const now = this.runtime.clock.now().toISOString();
    await this.unitOfWork.run(async (repositories) => {
      const access = await repositories.projects.findAccess(result.run.projectId, actorUserId);
      for (const permission of requiredPermissions) {
        authorizeProjectMember(access?.member ?? null, actorUserId, permission);
      }
      if (access === null) {
        throw new ApplicationError("NOT_FOUND", "Project was not found.");
      }
      requireActiveProject(access.project);
      const persistedRun = await repositories.runs.findAgentRun(
        result.run.projectId,
        result.run.id,
      );
      if (
        persistedRun === null ||
        persistedRun.version !== result.run.version ||
        persistedRun.status !== result.run.status
      ) {
        throw new ApplicationError(
          "CONFLICT",
          "The AgentRun changed before its outcome could be recorded.",
        );
      }
      let proposalPersisted = false;
      if (result.run.status === "completed" && result.proposal !== null) {
        const existing = await repositories.context.findDelta(
          result.run.projectId,
          result.proposal.id,
        );
        if (existing === null) {
          await repositories.context.insertDelta(result.proposal);
          proposalPersisted = true;
        }
      }
      if (auditOnlyWhenProposalPersisted && !proposalPersisted) {
        return;
      }
      await repositories.audit.append({
        id: auditEventIdSchema.parse(this.runtime.ids.next()),
        projectId: result.run.projectId,
        actor: { type: "human", userId: actorUserId },
        action,
        targetType: "agent_run",
        targetId: result.run.id,
        metadata: {
          status: result.run.status,
          proposalId: result.proposal?.id ?? null,
          proposalPersisted,
        },
        occurredAt: now,
      });
    });
  }
}
