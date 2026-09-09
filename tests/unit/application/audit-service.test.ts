import { AuditService } from "@cce/application";
import { agentRunSchema, auditEventSchema, modelRunSchema, userSchema } from "@cce/domain";
import { describe, expect, it } from "vitest";

import { createFixture, uuid } from "./fixtures";

describe("AuditService", () => {
  it("returns project-scoped model, Agent, and immutable audit history to a member", async () => {
    const fixture = createFixture("viewer");
    const modelRun = modelRunSchema.parse({
      id: uuid(20),
      projectId: fixture.project.id,
      conversationId: null,
      provider: "test-provider",
      model: "test-model",
      purpose: "classification",
      promptId: "audit-test",
      promptVersion: 1,
      inputHash: "a".repeat(64),
      status: "running",
      inputTokens: null,
      cachedTokens: null,
      outputTokens: null,
      latencyMs: null,
      errorCode: null,
      createdAt: fixture.clock.now().toISOString(),
      completedAt: null,
    });
    const agentRun = agentRunSchema.parse({
      id: uuid(21),
      projectId: fixture.project.id,
      agentName: "review",
      status: "queued",
      version: 0,
      state: { phase: "queued" },
      createdAt: fixture.clock.now().toISOString(),
      updatedAt: fixture.clock.now().toISOString(),
    });
    const event = auditEventSchema.parse({
      id: uuid(22),
      projectId: fixture.project.id,
      actor: { type: "human", userId: fixture.user.id },
      action: "audit.tested",
      targetType: "project",
      targetId: fixture.project.id,
      metadata: { source: "unit" },
      occurredAt: fixture.clock.now().toISOString(),
    });
    await fixture.unitOfWork.run(async (repositories) => {
      await repositories.runs.insertModelRun(modelRun);
      await repositories.runs.insertAgentRun(agentRun);
      await repositories.audit.append(event);
    });

    await expect(
      new AuditService(fixture.unitOfWork).getProjectHistory({
        projectId: fixture.project.id,
        actorUserId: fixture.user.id,
      }),
    ).resolves.toEqual({ modelRuns: [modelRun], agentRuns: [agentRun], events: [event] });
  });

  it("does not expose history or project existence to a non-member", async () => {
    const fixture = createFixture();
    const outsider = userSchema.parse({
      id: uuid(23),
      email: "outsider@example.test",
      displayName: "Outsider",
      createdAt: fixture.clock.now().toISOString(),
    });
    fixture.unitOfWork.seedUser(outsider);

    await expect(
      new AuditService(fixture.unitOfWork).getProjectHistory({
        projectId: fixture.project.id,
        actorUserId: outsider.id,
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});
