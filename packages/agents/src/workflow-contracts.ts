import {
  actorSchema,
  agentRunIdSchema,
  branchIdSchema,
  contextCommitIdSchema,
  contextDeltaSchema,
  contextItemProposalSchema,
  contextItemVersionSchema,
  contextItemVersionIdSchema,
  conversationIdSchema,
  logicalContextItemIdSchema,
  messageIdSchema,
  projectIdSchema,
  projectRoleSchema,
  userIdSchema,
} from "@cce/domain";
import { z } from "zod";

export const agentSpecialtySchema = z.enum(["extractor", "research", "review", "merge"]);
export type AgentSpecialty = z.infer<typeof agentSpecialtySchema>;

export const agentWorkflowPrincipalSchema = z
  .object({
    userId: userIdSchema,
    role: projectRoleSchema,
  })
  .strict();

export const workflowEvidenceSchema = z
  .object({
    messageId: messageIdSchema,
    sequence: z.int().positive().max(2_147_483_647),
    actor: actorSchema,
  })
  .strict();

export const startAgentWorkflowInputSchema = z
  .object({
    projectId: projectIdSchema,
    conversationId: conversationIdSchema,
    branchId: branchIdSchema,
    baseCommitId: contextCommitIdSchema,
    throughMessageSequence: z.int().nonnegative().max(2_147_483_647),
    objective: z.string().trim().min(1).max(4_000),
    routedContext: z.string().max(1_000_000),
    evidence: z.array(workflowEvidenceSchema).min(1).max(1_000),
    currentItems: z.array(contextItemVersionSchema).max(10_000),
    principal: agentWorkflowPrincipalSchema,
  })
  .strict()
  .superRefine((input, context) => {
    const messageIds = input.evidence.map((evidence) => evidence.messageId);
    if (new Set(messageIds).size !== messageIds.length) {
      context.addIssue({
        code: "custom",
        message: "Workflow evidence message IDs must be unique.",
        path: ["evidence"],
      });
    }
    for (const [index, evidence] of input.evidence.entries()) {
      if (evidence.sequence > input.throughMessageSequence) {
        context.addIssue({
          code: "custom",
          message: "Workflow evidence cannot be newer than throughMessageSequence.",
          path: ["evidence", index, "sequence"],
        });
      }
    }
  });

export const getAgentWorkflowInputSchema = z
  .object({
    projectId: projectIdSchema,
    runId: agentRunIdSchema,
    principal: agentWorkflowPrincipalSchema,
  })
  .strict();

export const resumeAgentWorkflowInputSchema = getAgentWorkflowInputSchema
  .extend({
    decision: z.enum(["approve", "reject"]),
    rationale: z.string().trim().min(1).max(2_000),
  })
  .strict();

export const cancelAgentWorkflowInputSchema = getAgentWorkflowInputSchema
  .extend({
    rationale: z.string().trim().min(1).max(2_000),
  })
  .strict();

export const managerSelectionSchema = z
  .object({
    specialty: agentSpecialtySchema,
    reason: z.string().trim().min(1).max(1_000),
  })
  .strict();

const modelContextItemProposalSchema = contextItemProposalSchema
  .omit({ authority: true, provenance: true })
  .strict();

const evidenceMessageIdsSchema = z
  .array(messageIdSchema)
  .min(1)
  .max(1_000)
  .superRefine((messageIds, context) => {
    if (new Set(messageIds).size !== messageIds.length) {
      context.addIssue({ code: "custom", message: "Evidence message IDs must be unique." });
    }
  });

const addDeltaDraftChangeSchema = z
  .object({
    operation: z.literal("add"),
    evidenceMessageIds: evidenceMessageIdsSchema,
    proposal: modelContextItemProposalSchema,
  })
  .strict();

const updateDeltaDraftChangeSchema = z
  .object({
    operation: z.literal("update"),
    targetLogicalItemId: logicalContextItemIdSchema,
    expectedBaseVersionId: contextItemVersionIdSchema,
    evidenceMessageIds: evidenceMessageIdsSchema,
    proposal: modelContextItemProposalSchema,
  })
  .strict();

const supersedeDeltaDraftChangeSchema = z
  .object({
    operation: z.literal("supersede"),
    targetLogicalItemId: logicalContextItemIdSchema,
    expectedBaseVersionId: contextItemVersionIdSchema,
    evidenceMessageIds: evidenceMessageIdsSchema,
    proposal: modelContextItemProposalSchema,
  })
  .strict();

const deprecateDeltaDraftChangeSchema = z
  .object({
    operation: z.literal("deprecate"),
    targetLogicalItemId: logicalContextItemIdSchema,
    expectedBaseVersionId: contextItemVersionIdSchema,
    evidenceMessageIds: evidenceMessageIdsSchema,
  })
  .strict();

export const agentDeltaDraftChangeSchema = z.discriminatedUnion("operation", [
  addDeltaDraftChangeSchema,
  updateDeltaDraftChangeSchema,
  supersedeDeltaDraftChangeSchema,
  deprecateDeltaDraftChangeSchema,
]);

export const agentDeltaDraftSchema = z
  .object({
    changes: z.array(agentDeltaDraftChangeSchema).max(500),
  })
  .strict();

export const researchFindingSchema = z
  .object({
    source: z.url().max(2_000),
    summary: z.string().trim().min(1).max(10_000),
  })
  .strict();

export const researchToolResultSchema = z
  .object({
    findings: z.array(researchFindingSchema).max(50),
  })
  .strict();

export const agentWorkflowFailureCodeSchema = z.enum([
  "MODEL_FAILURE",
  "MODEL_OUTPUT_INVALID",
  "TOOL_UNAVAILABLE",
  "TOOL_FAILURE",
  "TOOL_OUTPUT_INVALID",
]);

export const agentWorkflowPhaseSchema = z.enum([
  "queued",
  "selecting",
  "executing",
  "awaiting_approval",
  "completed",
  "failed",
  "cancelled",
]);

const storedWorkflowRequestSchema = z
  .object({
    conversationId: conversationIdSchema,
    branchId: branchIdSchema,
    baseCommitId: contextCommitIdSchema,
    throughMessageSequence: z.int().nonnegative().max(2_147_483_647),
    objective: z.string().trim().min(1).max(4_000),
    requestedBy: userIdSchema,
  })
  .strict();

const workflowApprovalSchema = z
  .object({
    decision: z.enum(["approved", "rejected"]),
    decidedBy: userIdSchema,
    rationale: z.string().trim().min(1).max(2_000),
    decidedAt: z.iso.datetime({ offset: true }),
  })
  .strict();

const workflowCancellationSchema = z
  .object({
    cancelledBy: userIdSchema,
    rationale: z.string().trim().min(1).max(2_000),
    cancelledAt: z.iso.datetime({ offset: true }),
  })
  .strict();

const workflowFailureSchema = z
  .object({
    code: agentWorkflowFailureCodeSchema,
    stage: z.enum(["manager", "research_tool", "specialist"]),
    message: z.string().trim().min(1).max(500),
  })
  .strict();

export const agentWorkflowStateSchema = z
  .object({
    schemaVersion: z.literal(1),
    phase: agentWorkflowPhaseSchema,
    request: storedWorkflowRequestSchema,
    selectedSpecialty: agentSpecialtySchema.nullable(),
    selectionReason: z.string().trim().min(1).max(1_000).nullable(),
    proposal: contextDeltaSchema.nullable(),
    approvalRequired: z.boolean(),
    approval: workflowApprovalSchema.nullable(),
    cancellation: workflowCancellationSchema.nullable(),
    failure: workflowFailureSchema.nullable(),
  })
  .strict()
  .superRefine((state, context) => {
    if ((state.phase === "failed") !== (state.failure !== null)) {
      context.addIssue({
        code: "custom",
        message: "Only a failed workflow contains failure details.",
        path: ["failure"],
      });
    }
    if (
      (state.phase === "cancelled") !==
      (state.cancellation !== null || state.approval?.decision === "rejected")
    ) {
      context.addIssue({
        code: "custom",
        message: "A cancelled workflow requires a cancellation or rejection decision.",
        path: ["cancellation"],
      });
    }
    if (
      ["executing", "awaiting_approval", "completed"].includes(state.phase) &&
      state.selectedSpecialty === null
    ) {
      context.addIssue({
        code: "custom",
        message: "The executing and proposal phases require a selected specialty.",
        path: ["selectedSpecialty"],
      });
    }
    if (["awaiting_approval", "completed"].includes(state.phase) && state.proposal === null) {
      context.addIssue({
        code: "custom",
        message: "The approval and completed phases require a Delta proposal.",
        path: ["proposal"],
      });
    }
    if (state.phase === "awaiting_approval" && !state.approvalRequired) {
      context.addIssue({
        code: "custom",
        message: "An awaiting workflow must require approval.",
        path: ["approvalRequired"],
      });
    }
    if (state.approval !== null && !state.approvalRequired) {
      context.addIssue({
        code: "custom",
        message: "An approval decision requires an approval-gated proposal.",
        path: ["approval"],
      });
    }
  });

export type AgentWorkflowPrincipal = z.infer<typeof agentWorkflowPrincipalSchema>;
export type WorkflowEvidence = z.infer<typeof workflowEvidenceSchema>;
export type StartAgentWorkflowInput = z.infer<typeof startAgentWorkflowInputSchema>;
export type GetAgentWorkflowInput = z.infer<typeof getAgentWorkflowInputSchema>;
export type ResumeAgentWorkflowInput = z.infer<typeof resumeAgentWorkflowInputSchema>;
export type CancelAgentWorkflowInput = z.infer<typeof cancelAgentWorkflowInputSchema>;
export type ManagerSelection = z.infer<typeof managerSelectionSchema>;
export type AgentDeltaDraft = z.infer<typeof agentDeltaDraftSchema>;
export type AgentDeltaDraftChange = z.infer<typeof agentDeltaDraftChangeSchema>;
export type ResearchToolResult = z.infer<typeof researchToolResultSchema>;
export type AgentWorkflowFailureCode = z.infer<typeof agentWorkflowFailureCodeSchema>;
export type AgentWorkflowState = z.infer<typeof agentWorkflowStateSchema>;
