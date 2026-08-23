import { describe, expect, it } from "vitest";

import {
  addProjectMemberBodySchema,
  agentRunPathParamsSchema,
  appendMessageBodySchema,
  cancelAgentRunBodySchema,
  changeProjectMemberRoleBodySchema,
  conversationPathParamsSchema,
  createAgentRunBodySchema,
  createChatBodySchema,
  createContextDeltaBodySchema,
  createConversationBodySchema,
  createMergeRequestBodySchema,
  createProjectBodySchema,
  createSessionBodySchema,
  editableContextItemProposalSchema,
  finalizeMergeRequestBodySchema,
  finalizeMergeRequestHeadersSchema,
  getContextQuerySchema,
  mergeConflictPathParamsSchema,
  projectMemberPathParamsSchema,
  projectPathParamsSchema,
  resolveMergeConflictBodySchema,
  reconcileAgentRunBodySchema,
  resumeAgentRunBodySchema,
  updateConversationBodySchema,
  updateProjectBodySchema,
} from "./index";

const ids = {
  project: "00000000-0000-4000-8000-000000000001",
  conversation: "00000000-0000-4000-8000-000000000002",
  delta: "00000000-0000-4000-8000-000000000003",
  mergeRequest: "00000000-0000-4000-8000-000000000004",
  conflict: "00000000-0000-4000-8000-000000000005",
  run: "00000000-0000-4000-8000-000000000006",
  user: "00000000-0000-4000-8000-000000000007",
  commit: "00000000-0000-4000-8000-000000000008",
  clientMessage: "00000000-0000-4000-8000-000000000009",
} as const;

describe("REST request contracts", () => {
  it("accepts only the user-controlled fields for ordinary requests", () => {
    expect(createSessionBodySchema.parse({ apiToken: "opaque-token-value-12345678" })).toEqual({
      apiToken: "opaque-token-value-12345678",
    });
    expect(createProjectBodySchema.parse({ name: "CCE" })).toEqual({ name: "CCE" });
    expect(updateProjectBodySchema.parse({ name: "CCE 2", archive: true })).toEqual({
      name: "CCE 2",
      archive: true,
    });
    expect(
      addProjectMemberBodySchema.parse({ email: "member@example.com", role: "editor" }),
    ).toEqual({ email: "member@example.com", role: "editor" });
    expect(changeProjectMemberRoleBodySchema.parse({ role: "viewer" })).toEqual({
      role: "viewer",
    });
    expect(createConversationBodySchema.parse({ title: "Architecture" })).toEqual({
      title: "Architecture",
    });
    expect(updateConversationBodySchema.parse({ title: "Architecture 2" })).toEqual({
      title: "Architecture 2",
    });
    expect(
      appendMessageBodySchema.parse({
        clientMessageId: ids.clientMessage,
        content: "Keep REST as the public API.",
      }),
    ).toMatchObject({ clientMessageId: ids.clientMessage });
    expect(createContextDeltaBodySchema.parse({ throughMessageSequence: 3 })).toEqual({
      throughMessageSequence: 3,
    });
    expect(createContextDeltaBodySchema.parse({})).toEqual({});
    expect(createMergeRequestBodySchema.parse({ deltaId: ids.delta })).toEqual({
      deltaId: ids.delta,
    });
    expect(
      createAgentRunBodySchema.parse({
        conversationId: ids.conversation,
        throughMessageSequence: 3,
        objective: "Extract durable requirements",
      }),
    ).toMatchObject({ conversationId: ids.conversation });
  });

  it.each([
    [createSessionBodySchema, { apiToken: "opaque-token-value-12345678" }, "actorUserId"],
    [createProjectBodySchema, { name: "CCE" }, "createdBy"],
    [addProjectMemberBodySchema, { email: "member@example.com", role: "editor" }, "projectId"],
    [createConversationBodySchema, { title: "Architecture" }, "actor"],
    [
      appendMessageBodySchema,
      { clientMessageId: ids.clientMessage, content: "Evidence" },
      "author",
    ],
    [
      createChatBodySchema,
      { clientMessageId: ids.clientMessage, content: "Evidence" },
      "projectId",
    ],
    [createContextDeltaBodySchema, { throughMessageSequence: 3 }, "proposedBy"],
    [createMergeRequestBodySchema, { deltaId: ids.delta }, "createdBy"],
    [
      createAgentRunBodySchema,
      {
        conversationId: ids.conversation,
        throughMessageSequence: 3,
        objective: "Extract",
      },
      "agentName",
    ],
  ])("rejects the server-authoritative %s field", (schema, validBody, forbiddenField) => {
    expect(schema.safeParse({ ...validBody, [forbiddenField]: ids.user }).success).toBe(false);
  });

  it("keeps route scope in path schemas rather than request bodies", () => {
    expect(projectPathParamsSchema.parse({ projectId: ids.project })).toEqual({
      projectId: ids.project,
    });
    expect(
      projectMemberPathParamsSchema.parse({ projectId: ids.project, userId: ids.user }),
    ).toEqual({ projectId: ids.project, userId: ids.user });
    expect(
      conversationPathParamsSchema.parse({
        projectId: ids.project,
        conversationId: ids.conversation,
      }),
    ).toMatchObject({ projectId: ids.project, conversationId: ids.conversation });
    expect(
      mergeConflictPathParamsSchema.parse({
        projectId: ids.project,
        mergeRequestId: ids.mergeRequest,
        conflictId: ids.conflict,
      }),
    ).toMatchObject({ projectId: ids.project, conflictId: ids.conflict });
    expect(agentRunPathParamsSchema.parse({ projectId: ids.project, runId: ids.run })).toEqual({
      projectId: ids.project,
      runId: ids.run,
    });
  });

  it("rejects malformed identifiers and unknown context filters", () => {
    expect(projectPathParamsSchema.safeParse({ projectId: "not-a-uuid" }).success).toBe(false);
    expect(getContextQuerySchema.safeParse({ lifecycle: "deleted" }).success).toBe(false);
    expect(getContextQuerySchema.safeParse({ projectId: ids.project }).success).toBe(false);
    expect(updateProjectBodySchema.safeParse({}).success).toBe(false);
    expect(updateProjectBodySchema.safeParse({ archive: false }).success).toBe(false);
    expect(updateConversationBodySchema.safeParse({}).success).toBe(false);
    expect(updateConversationBodySchema.safeParse({ status: "archived" }).success).toBe(false);
  });
});

describe("merge request contracts", () => {
  const edit = {
    kind: "requirement",
    key: "api.protocol",
    value: "REST",
    scope: { tags: ["api"] },
    explicitSupersedesVersionId: null,
  } as const;

  it("accepts an editable value without authority or provenance", () => {
    expect(editableContextItemProposalSchema.parse(edit)).toEqual(edit);
    expect(
      resolveMergeConflictBodySchema.parse({
        choice: "edit",
        editedProposal: edit,
        rationale: "Clarifies the accepted protocol.",
      }),
    ).toMatchObject({ choice: "edit", editedProposal: edit });
  });

  it.each(["authority", "confidence", "provenance", "resolvedBy", "resolvedAt"])(
    "rejects client-supplied merge authority field %s",
    (field) => {
      const body = {
        choice: "edit",
        editedProposal: { ...edit, [field]: field === "provenance" ? [] : ids.user },
        rationale: "Human edit",
      };
      if (field === "resolvedBy" || field === "resolvedAt") {
        body.editedProposal = edit;
        expect(
          resolveMergeConflictBodySchema.safeParse({ ...body, [field]: ids.user }).success,
        ).toBe(false);
      } else {
        expect(resolveMergeConflictBodySchema.safeParse(body).success).toBe(false);
      }
    },
  );

  it("requires editedProposal exactly for an edit resolution", () => {
    expect(
      resolveMergeConflictBodySchema.safeParse({
        choice: "edit",
        rationale: "Missing edit",
      }).success,
    ).toBe(false);
    expect(
      resolveMergeConflictBodySchema.safeParse({
        choice: "keep_current",
        editedProposal: edit,
        rationale: "Keep current",
      }).success,
    ).toBe(false);
    expect(
      resolveMergeConflictBodySchema.parse({
        choice: "accept_proposed",
        rationale: "Proposal is correct",
      }),
    ).toEqual({
      choice: "accept_proposed",
      editedProposal: null,
      rationale: "Proposal is correct",
    });
  });

  it("requires concurrency and idempotency values without accepting a committer", () => {
    expect(
      finalizeMergeRequestBodySchema.parse({
        expectedHeadCommitId: ids.commit,
        summary: "Accept reviewed ContextDelta",
      }),
    ).toEqual({
      expectedHeadCommitId: ids.commit,
      summary: "Accept reviewed ContextDelta",
    });
    expect(finalizeMergeRequestHeadersSchema.parse({ "idempotency-key": "merge-42" })).toEqual({
      "idempotency-key": "merge-42",
    });
    expect(
      finalizeMergeRequestBodySchema.safeParse({
        expectedHeadCommitId: ids.commit,
        summary: "Accept reviewed ContextDelta",
        committedBy: ids.user,
      }).success,
    ).toBe(false);
    expect(finalizeMergeRequestHeadersSchema.safeParse({}).success).toBe(false);
  });
});

describe("AgentRun control contracts", () => {
  it("uses an explicit empty command for reconciliation", () => {
    expect(reconcileAgentRunBodySchema.parse({})).toEqual({});
    expect(reconcileAgentRunBodySchema.safeParse({ actorUserId: ids.user }).success).toBe(false);
  });

  it("accepts only a human decision and rationale when resuming", () => {
    expect(
      resumeAgentRunBodySchema.parse({ decision: "approve", rationale: "Reviewed evidence" }),
    ).toEqual({ decision: "approve", rationale: "Reviewed evidence" });
    expect(
      resumeAgentRunBodySchema.safeParse({
        decision: "approve",
        rationale: "Reviewed evidence",
        approvedBy: ids.user,
      }).success,
    ).toBe(false);
  });

  it("does not let cancellation bodies choose run status or project scope", () => {
    expect(cancelAgentRunBodySchema.parse({ rationale: "No longer needed" })).toEqual({
      rationale: "No longer needed",
    });
    expect(
      cancelAgentRunBodySchema.safeParse({
        rationale: "No longer needed",
        status: "cancelled",
        projectId: ids.project,
      }).success,
    ).toBe(false);
  });
});
