import {
  ContextService,
  ConversationService,
  ProjectService,
  SessionService,
} from "@cce/application";
import { conversationIdSchema, userSchema } from "@cce/domain";
import { InMemoryUnitOfWork } from "@cce/test-support";
import { describe, expect, it } from "vitest";

import { createFixture, idsFrom, seedConversation, uuid } from "./fixtures";

describe("ProjectService", () => {
  it("creates a project, owner, genesis commit, and audit event atomically", async () => {
    const unitOfWork = new InMemoryUnitOfWork();
    const user = userSchema.parse({
      id: uuid(1),
      email: "owner@example.test",
      displayName: "Owner",
      createdAt: "2026-08-23T00:00:00.000Z",
    });
    unitOfWork.seedUser(user);
    const fixture = createFixture();
    const service = new ProjectService(unitOfWork, idsFrom(100), fixture.clock);

    const project = await service.create({ name: "Context Engine", actorUserId: user.id });

    expect(project.version).toBe(0);
    expect(unitOfWork.view().projects).toEqual([project]);
    expect(unitOfWork.view().members).toMatchObject([
      { projectId: project.id, userId: user.id, role: "owner" },
    ]);
    expect(unitOfWork.view().commits).toMatchObject([
      { projectId: project.id, kind: "genesis", parentCommitId: null, changes: [] },
    ]);
    expect(unitOfWork.view().auditEvents).toMatchObject([
      { action: "project.created", targetId: project.id },
    ]);
  });

  it("does not allow the last owner to be demoted", async () => {
    const fixture = createFixture();
    const service = new ProjectService(fixture.unitOfWork, idsFrom(100), fixture.clock);

    await expect(
      service.changeMemberRole({
        projectId: fixture.project.id,
        actorUserId: fixture.user.id,
        targetUserId: fixture.user.id,
        role: "editor",
      }),
    ).rejects.toMatchObject({ code: "LAST_OWNER" });
    expect(fixture.unitOfWork.view().members[0]?.role).toBe("owner");
    expect(fixture.unitOfWork.view().auditEvents).toHaveLength(0);
  });

  it("manages members and exposes only projects belonging to the caller", async () => {
    const fixture = createFixture();
    const secondUser = userSchema.parse({
      id: uuid(50),
      email: "bob@example.test",
      displayName: "Bob",
      createdAt: "2026-08-23T00:00:00.000Z",
    });
    fixture.unitOfWork.seedUser(secondUser);
    const service = new ProjectService(fixture.unitOfWork, idsFrom(100), fixture.clock);

    await service.addMember({
      projectId: fixture.project.id,
      actorUserId: fixture.user.id,
      memberEmail: secondUser.email,
      role: "editor",
    });
    await expect(service.list(secondUser.id)).resolves.toMatchObject([
      { project: { id: fixture.project.id }, member: { role: "editor" } },
    ]);
    await expect(service.get(fixture.project.id, secondUser.id)).resolves.toMatchObject({
      member: { userId: secondUser.id, role: "editor" },
    });

    await service.changeMemberRole({
      projectId: fixture.project.id,
      actorUserId: fixture.user.id,
      targetUserId: secondUser.id,
      role: "owner",
    });
    expect(fixture.unitOfWork.view().members).toContainEqual(
      expect.objectContaining({ userId: secondUser.id, role: "owner" }),
    );
    expect(fixture.unitOfWork.view().auditEvents.map((event) => event.action)).toEqual([
      "project.member_added",
      "project.member_role_changed",
    ]);
  });

  it("rolls back every project aggregate write when the authenticated user disappeared", async () => {
    const unitOfWork = new InMemoryUnitOfWork();
    const fixture = createFixture();
    const service = new ProjectService(unitOfWork, idsFrom(100), fixture.clock);

    await expect(
      service.create({ name: "Must roll back", actorUserId: fixture.user.id }),
    ).rejects.toMatchObject({ code: "UNAUTHENTICATED" });
    expect(unitOfWork.view().projects).toEqual([]);
    expect(unitOfWork.view().commits).toEqual([]);
    expect(unitOfWork.view().members).toEqual([]);
  });

  it("lets only an Owner rename and one-way archive a project with audit history", async () => {
    const fixture = createFixture();
    const service = new ProjectService(fixture.unitOfWork, idsFrom(100), fixture.clock);

    const renamed = await service.update({
      projectId: fixture.project.id,
      actorUserId: fixture.user.id,
      name: "Collaborative Context Engine",
    });
    const archived = await service.update({
      projectId: fixture.project.id,
      actorUserId: fixture.user.id,
      archive: true,
    });

    expect(renamed).toMatchObject({
      name: "Collaborative Context Engine",
      headCommitId: fixture.project.headCommitId,
      version: fixture.project.version,
    });
    expect(archived.archivedAt).toBe("2026-08-23T01:00:00.000Z");
    expect(fixture.unitOfWork.view().auditEvents.map((event) => event.action)).toEqual([
      "project.updated",
      "project.updated",
    ]);
    await expect(
      service.update({
        projectId: fixture.project.id,
        actorUserId: fixture.user.id,
        name: "Renaming archived state is forbidden",
      }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("rejects a non-Owner project metadata mutation", async () => {
    const fixture = createFixture("editor");
    const service = new ProjectService(fixture.unitOfWork, idsFrom(100), fixture.clock);

    await expect(
      service.update({
        projectId: fixture.project.id,
        actorUserId: fixture.user.id,
        name: "Editors cannot rename projects",
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(fixture.unitOfWork.view().projects).toEqual([fixture.project]);
  });
});

describe("Conversation and Context services", () => {
  it("makes client message IDs idempotent and preserves sequence order", async () => {
    const fixture = createFixture();
    const { conversation } = seedConversation(fixture);
    const service = new ConversationService(fixture.unitOfWork, idsFrom(100), fixture.clock);
    const input = {
      projectId: fixture.project.id,
      conversationId: conversation.id,
      actorUserId: fixture.user.id,
      clientMessageId: uuid(80),
      content: "Use a linear commit chain.",
    } as const;

    const first = await service.appendUserMessage(input);
    const replay = await service.appendUserMessage(input);

    expect(replay).toEqual(first);
    expect(first.sequence).toBe(2);
    expect(fixture.unitOfWork.view().messages).toHaveLength(2);
    expect(fixture.unitOfWork.view().auditEvents).toHaveLength(1);
  });

  it("allows viewers to read but not append conversation evidence", async () => {
    const fixture = createFixture("viewer");
    const { conversation } = seedConversation(fixture);
    const conversations = new ConversationService(
      fixture.unitOfWork,
      idsFrom(100),
      fixture.clock,
    );

    await expect(
      conversations.listMessages({
        projectId: fixture.project.id,
        conversationId: conversation.id,
        actorUserId: fixture.user.id,
      }),
    ).resolves.toHaveLength(1);
    await expect(
      conversations.appendUserMessage({
        projectId: fixture.project.id,
        conversationId: conversation.id,
        actorUserId: fixture.user.id,
        clientMessageId: uuid(81),
        content: "This must not be written.",
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(fixture.unitOfWork.view().messages).toHaveLength(1);
  });

  it("builds prompts from canonical Context plus completed recent evidence", async () => {
    const fixture = createFixture();
    const { conversation, message } = seedConversation(fixture);
    const context = new ContextService(fixture.unitOfWork);

    const pack = await context.buildForConversation({
      projectId: fixture.project.id,
      conversationId: conversation.id,
      actorUserId: fixture.user.id,
      maxRecentMessages: 10,
      recentMessageCharacterBudget: 1_000,
    });

    expect(pack.project.headCommitId).toBe(fixture.genesis.id);
    expect(pack.recentMessages).toEqual([message]);
    expect(pack.decisions).toEqual([]);
  });

  it("creates a fixed-base Branch and lists its Conversation", async () => {
    const fixture = createFixture();
    const conversations = new ConversationService(
      fixture.unitOfWork,
      idsFrom(100),
      fixture.clock,
    );

    const conversation = await conversations.create({
      projectId: fixture.project.id,
      actorUserId: fixture.user.id,
      title: "New design thread",
    });
    await expect(conversations.list(fixture.project.id, fixture.user.id)).resolves.toEqual([
      conversation,
    ]);
    expect(fixture.unitOfWork.view().branches[0]).toMatchObject({
      id: conversation.branchId,
      baseCommitId: fixture.project.headCommitId,
      status: "open",
    });
  });

  it("gets, renames, and archives a project-scoped Conversation atomically", async () => {
    const fixture = createFixture("editor");
    const { conversation } = seedConversation(fixture);
    const conversations = new ConversationService(
      fixture.unitOfWork,
      idsFrom(100),
      fixture.clock,
    );

    await expect(
      conversations.get({
        projectId: fixture.project.id,
        conversationId: conversation.id,
        actorUserId: fixture.user.id,
      }),
    ).resolves.toEqual(conversation);
    const renamed = await conversations.update({
      projectId: fixture.project.id,
      conversationId: conversation.id,
      actorUserId: fixture.user.id,
      title: "Architecture decisions",
    });
    const archived = await conversations.update({
      projectId: fixture.project.id,
      conversationId: conversation.id,
      actorUserId: fixture.user.id,
      archive: true,
    });

    expect(renamed.title).toBe("Architecture decisions");
    expect(archived).toMatchObject({
      title: "Architecture decisions",
      status: "archived",
      archivedAt: "2026-08-23T01:00:00.000Z",
    });
    expect(fixture.unitOfWork.view().branches[0]).toMatchObject({
      status: "abandoned",
      closedAt: "2026-08-23T01:00:00.000Z",
    });
    expect(fixture.unitOfWork.view().auditEvents.map((event) => event.action)).toEqual([
      "conversation.updated",
      "conversation.updated",
    ]);
    await expect(
      conversations.appendUserMessage({
        projectId: fixture.project.id,
        conversationId: conversation.id,
        actorUserId: fixture.user.id,
        clientMessageId: uuid(82),
        content: "Archived evidence cannot be extended.",
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("keeps Conversation mutations unavailable to Viewers", async () => {
    const fixture = createFixture("viewer");
    const { conversation } = seedConversation(fixture);
    const conversations = new ConversationService(
      fixture.unitOfWork,
      idsFrom(100),
      fixture.clock,
    );

    await expect(
      conversations.update({
        projectId: fixture.project.id,
        conversationId: conversation.id,
        actorUserId: fixture.user.id,
        archive: true,
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(fixture.unitOfWork.view().conversations).toEqual([conversation]);
  });

  it("lists canonical commits/items and hides missing Conversations", async () => {
    const fixture = createFixture();
    const context = new ContextService(fixture.unitOfWork);
    const conversations = new ConversationService(
      fixture.unitOfWork,
      idsFrom(100),
      fixture.clock,
    );

    await expect(
      context.listCommits({ projectId: fixture.project.id, actorUserId: fixture.user.id }),
    ).resolves.toEqual([fixture.genesis]);
    await expect(
      context.listCurrentItems({
        projectId: fixture.project.id,
        actorUserId: fixture.user.id,
      }),
    ).resolves.toEqual([]);
    await expect(
      conversations.listMessages({
        projectId: fixture.project.id,
        conversationId: conversationIdSchema.parse(uuid(999)),
        actorUserId: fixture.user.id,
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

describe("SessionService", () => {
  it("authenticates only the SHA-256 hash of a sufficiently long token", async () => {
    const fixture = createFixture();
    const rawToken = "cce_test_token_12345678901234567890";
    fixture.unitOfWork.seedUser(
      userSchema.parse({
        id: uuid(50),
        email: "token@example.test",
        displayName: "Token User",
        createdAt: "2026-08-23T00:00:00.000Z",
      }),
      fixture.hasher.sha256(rawToken),
    );
    const service = new SessionService(fixture.unitOfWork, fixture.hasher);

    await expect(service.authenticateApiToken(rawToken)).resolves.toMatchObject({
      email: "token@example.test",
    });
    await expect(service.authenticateApiToken("short")).rejects.toMatchObject({
      code: "UNAUTHENTICATED",
    });
    await expect(
      service.authenticateApiToken("cce_unknown_token_12345678901234567890"),
    ).rejects.toMatchObject({ code: "UNAUTHENTICATED" });
  });
});
