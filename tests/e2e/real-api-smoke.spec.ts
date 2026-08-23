import { randomUUID } from "node:crypto";

import {
  contextDeltaResponseSchema,
  contextSnapshotResponseSchema,
  conversationResponseSchema,
  finalizeMergeRequestResponseSchema,
  messageListResponseSchema,
  messageResponseSchema,
  mergeRequestDetailResponseSchema,
  projectMemberListResponseSchema,
  projectResponseSchema,
  sessionResponseSchema,
} from "@cce/api-contracts";
import { expect, test } from "@playwright/test";
import { z } from "zod";

const healthResponseSchema = z
  .object({ status: z.literal("ok"), database: z.literal("available") })
  .strict();

function requiredApiToken(): string {
  const token = process.env["CCE_E2E_API_TOKEN"] ?? process.env["CCE_SEED_API_TOKEN"];
  if (token === undefined || token.length < 24) {
    throw new Error(
      "CCE_E2E_API_TOKEN (or CCE_SEED_API_TOKEN) must contain the API token seeded into the E2E PostgreSQL database.",
    );
  }
  return token;
}

function requiredViewerApiToken(): string {
  const token = process.env["CCE_E2E_VIEWER_API_TOKEN"];
  if (token === undefined || token.length < 24) {
    throw new Error("CCE_E2E_VIEWER_API_TOKEN must identify the seeded Viewer user.");
  }
  return token;
}

function requiredEditorApiToken(): string {
  const token = process.env["CCE_E2E_EDITOR_API_TOKEN"];
  if (token === undefined || token.length < 24) {
    throw new Error("CCE_E2E_EDITOR_API_TOKEN must identify the seeded Editor user.");
  }
  return token;
}

const editorEmail = "e2e-bob@example.test";
const viewerEmail = "e2e-viewer@example.test";

test("real Next routes persist an Owner-to-Editor canonical conflict flow", async ({
  request,
  baseURL,
}) => {
  const origin = baseURL ?? "http://127.0.0.1:3000";
  const health = await request.get("/api/health");
  expect(health.status()).toBe(200);
  const healthPayload: unknown = await health.json();
  expect(healthResponseSchema.parse(healthPayload)).toEqual({
    status: "ok",
    database: "available",
  });

  const login = await request.post("/api/session", {
    headers: { origin },
    data: { apiToken: requiredApiToken() },
  });
  expect(login.status()).toBe(200);
  const loginPayload: unknown = await login.json();
  const session = sessionResponseSchema.parse(loginPayload);

  const createProject = await request.post("/api/projects", {
    headers: { origin },
    data: { name: `CCE E2E ${randomUUID()}` },
  });
  expect(createProject.status()).toBe(201);
  const projectPayload: unknown = await createProject.json();
  const project = projectResponseSchema.parse(projectPayload);
  expect(project.createdBy).toBe(session.user.id);
  expect(project.version).toBe(0);

  const addEditor = await request.post(`/api/projects/${project.id}/members`, {
    headers: { origin },
    data: { email: editorEmail, role: "editor" },
  });
  expect(addEditor.status()).toBe(201);
  const addViewer = await request.post(`/api/projects/${project.id}/members`, {
    headers: { origin },
    data: { email: viewerEmail, role: "viewer" },
  });
  expect(addViewer.status()).toBe(201);

  const createConversation = await request.post(`/api/projects/${project.id}/conversations`, {
    headers: { origin },
    data: { title: "Conversation A — establish PostgreSQL" },
  });
  expect(createConversation.status()).toBe(201);
  const conversationPayload: unknown = await createConversation.json();
  const conversation = conversationResponseSchema.parse(conversationPayload);

  const appendMessage = await request.post(
    `/api/projects/${project.id}/conversations/${conversation.id}/messages`,
    {
      headers: { origin },
      data: {
        clientMessageId: randomUUID(),
        content: "Set database.engine to PostgreSQL as the canonical project database.",
      },
    },
  );
  expect(appendMessage.status()).toBe(201);
  const messagePayload: unknown = await appendMessage.json();
  const message = messageResponseSchema.parse(messagePayload);
  expect(message.sequence).toBe(1);
  expect(message.author).toEqual({ type: "human", userId: session.user.id });

  const readContext = await request.get(`/api/projects/${project.id}/context`);
  expect(readContext.status()).toBe(200);
  const contextPayload: unknown = await readContext.json();
  const context = contextSnapshotResponseSchema.parse(contextPayload);
  expect(context.commitId).toBe(project.headCommitId);
  expect(context.items).toEqual([]);

  const extract = await request.post(
    `/api/projects/${project.id}/conversations/${conversation.id}/extract`,
    { headers: { origin }, data: { throughMessageSequence: message.sequence } },
  );
  expect(extract.status()).toBe(201);
  const delta = contextDeltaResponseSchema.parse((await extract.json()) as unknown);
  expect(delta.changes[0]).toMatchObject({
    operation: "add",
    proposal: { key: "database.engine", value: "PostgreSQL" },
  });

  const createMerge = await request.post(`/api/projects/${project.id}/merge-requests`, {
    headers: { origin },
    data: { deltaId: delta.id },
  });
  expect(createMerge.status()).toBe(201);
  const merge = mergeRequestDetailResponseSchema.parse((await createMerge.json()) as unknown);
  expect(merge.conflicts.length).toBeGreaterThan(0);

  for (const conflict of merge.conflicts) {
    const resolve = await request.put(
      `/api/projects/${project.id}/merge-requests/${merge.request.id}/conflicts/${conflict.id}/resolution`,
      {
        headers: { origin },
        data: {
          choice: "accept_proposed",
          editedProposal: null,
          rationale: "Owner accepts evidence-backed E2E context.",
        },
      },
    );
    expect(resolve.status()).toBe(200);
  }

  const idempotencyKey = randomUUID();
  const finalizeUrl = `/api/projects/${project.id}/merge-requests/${merge.request.id}/finalize`;
  const finalize = await request.post(finalizeUrl, {
    headers: { origin, "idempotency-key": idempotencyKey },
    data: {
      expectedHeadCommitId: project.headCommitId,
      summary: "Commit deterministic E2E ContextDelta",
    },
  });
  expect(finalize.status()).toBe(200);
  const finalized = finalizeMergeRequestResponseSchema.parse((await finalize.json()) as unknown);
  expect(finalized.outcome).toBe("committed");

  const replayFinalize = await request.post(finalizeUrl, {
    headers: { origin, "idempotency-key": idempotencyKey },
    data: {
      expectedHeadCommitId: project.headCommitId,
      summary: "Commit deterministic E2E ContextDelta",
    },
  });
  expect(replayFinalize.status()).toBe(200);
  expect(
    finalizeMergeRequestResponseSchema.parse((await replayFinalize.json()) as unknown),
  ).toEqual(finalized);

  const committedContextResponse = await request.get(`/api/projects/${project.id}/context`);
  const committedContext = contextSnapshotResponseSchema.parse(
    (await committedContextResponse.json()) as unknown,
  );
  expect(committedContext.items).toEqual([
    expect.objectContaining({ key: "database.engine", value: "PostgreSQL" }),
  ]);
  if (finalized.outcome === "committed") {
    expect(committedContext.commitId).toBe(finalized.commit.id);
  }
  if (finalized.outcome !== "committed") {
    throw new Error("The PostgreSQL merge must produce a semantic commit.");
  }
  const postgresCommitId = finalized.commit.id;

  const editorLogin = await request.post("/api/session", {
    headers: { origin },
    data: { apiToken: requiredEditorApiToken() },
  });
  expect(editorLogin.status()).toBe(200);
  const editorSessionPayload: unknown = await editorLogin.json();
  const editorSession = sessionResponseSchema.parse(editorSessionPayload);

  const memberListResponse = await request.get(`/api/projects/${project.id}/members`);
  expect(memberListResponse.status()).toBe(200);
  const memberListPayload: unknown = await memberListResponse.json();
  const members = projectMemberListResponseSchema.parse(memberListPayload);
  expect(members).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ userId: session.user.id, role: "owner" }),
      expect.objectContaining({ userId: editorSession.user.id, role: "editor" }),
      expect.objectContaining({ role: "viewer" }),
    ]),
  );

  const deniedMemberManagement = await request.post(`/api/projects/${project.id}/members`, {
    headers: { origin },
    data: { email: viewerEmail, role: "editor" },
  });
  expect(deniedMemberManagement.status()).toBe(403);

  const editorContextResponse = await request.get(`/api/projects/${project.id}/context`);
  expect(editorContextResponse.status()).toBe(200);
  const editorContextPayload: unknown = await editorContextResponse.json();
  expect(contextSnapshotResponseSchema.parse(editorContextPayload).items).toEqual([
    expect.objectContaining({ key: "database.engine", value: "PostgreSQL" }),
  ]);

  const conversationBResponse = await request.post(`/api/projects/${project.id}/conversations`, {
    headers: { origin },
    data: { title: "Conversation B — propose MySQL" },
  });
  expect(conversationBResponse.status()).toBe(201);
  const conversationBPayload: unknown = await conversationBResponse.json();
  const conversationB = conversationResponseSchema.parse(conversationBPayload);

  const appendMysqlEvidence = await request.post(
    `/api/projects/${project.id}/conversations/${conversationB.id}/messages`,
    {
      headers: { origin },
      data: {
        clientMessageId: randomUUID(),
        content: "Replace canonical database.engine with MySQL for this project.",
      },
    },
  );
  expect(appendMysqlEvidence.status()).toBe(201);
  const mysqlMessagePayload: unknown = await appendMysqlEvidence.json();
  const mysqlMessage = messageResponseSchema.parse(mysqlMessagePayload);
  expect(mysqlMessage.author).toEqual({ type: "human", userId: editorSession.user.id });

  const extractMysql = await request.post(
    `/api/projects/${project.id}/conversations/${conversationB.id}/extract`,
    { headers: { origin }, data: { throughMessageSequence: mysqlMessage.sequence } },
  );
  expect(extractMysql.status()).toBe(201);
  const mysqlDeltaPayload: unknown = await extractMysql.json();
  const mysqlDelta = contextDeltaResponseSchema.parse(mysqlDeltaPayload);
  expect(mysqlDelta.baseCommitId).toBe(postgresCommitId);
  expect(mysqlDelta.changes).toEqual([
    expect.objectContaining({
      operation: "add",
      proposal: expect.objectContaining({ key: "database.engine", value: "MySQL" }),
    }),
  ]);

  const createMysqlMerge = await request.post(`/api/projects/${project.id}/merge-requests`, {
    headers: { origin },
    data: { deltaId: mysqlDelta.id },
  });
  expect(createMysqlMerge.status()).toBe(201);
  const mysqlMergePayload: unknown = await createMysqlMerge.json();
  const mysqlMerge = mergeRequestDetailResponseSchema.parse(mysqlMergePayload);
  expect(mysqlMerge.conflicts).toHaveLength(1);
  const databaseConflict = mysqlMerge.conflicts[0];
  if (databaseConflict === undefined) {
    throw new Error("The MySQL proposal must conflict with canonical PostgreSQL.");
  }
  expect(databaseConflict).toMatchObject({
    classification: "C3",
    currentVersion: { key: "database.engine", value: "PostgreSQL" },
    proposed: { key: "database.engine", value: "MySQL" },
  });

  const resolveMysqlConflict = await request.put(
    `/api/projects/${project.id}/merge-requests/${mysqlMerge.request.id}/conflicts/${databaseConflict.id}/resolution`,
    {
      headers: { origin },
      data: {
        choice: "accept_proposed",
        editedProposal: null,
        rationale: "Editor accepts the evidence-backed low-risk database fact.",
      },
    },
  );
  expect(resolveMysqlConflict.status()).toBe(200);

  const finalizeMysql = await request.post(
    `/api/projects/${project.id}/merge-requests/${mysqlMerge.request.id}/finalize`,
    {
      headers: { origin, "idempotency-key": randomUUID() },
      data: {
        expectedHeadCommitId: postgresCommitId,
        summary: "Replace canonical PostgreSQL with MySQL from Conversation B",
      },
    },
  );
  expect(finalizeMysql.status()).toBe(200);
  const finalizedMysqlPayload: unknown = await finalizeMysql.json();
  const finalizedMysql = finalizeMergeRequestResponseSchema.parse(finalizedMysqlPayload);
  expect(finalizedMysql.outcome).toBe("committed");
  if (finalizedMysql.outcome !== "committed") {
    throw new Error("The accepted MySQL conflict must produce a semantic commit.");
  }

  const mysqlContextResponse = await request.get(`/api/projects/${project.id}/context`);
  expect(mysqlContextResponse.status()).toBe(200);
  const mysqlContextPayload: unknown = await mysqlContextResponse.json();
  const mysqlContext = contextSnapshotResponseSchema.parse(mysqlContextPayload);
  expect(mysqlContext.commitId).toBe(finalizedMysql.commit.id);
  expect(mysqlContext.items).toEqual([
    expect.objectContaining({ key: "database.engine", value: "MySQL" }),
  ]);

  const conversationCResponse = await request.post(`/api/projects/${project.id}/conversations`, {
    headers: { origin },
    data: { title: "Conversation C — consume canonical context" },
  });
  expect(conversationCResponse.status()).toBe(201);
  const conversationCPayload: unknown = await conversationCResponse.json();
  const conversationC = conversationResponseSchema.parse(conversationCPayload);
  const chat = await request.post(
    `/api/projects/${project.id}/conversations/${conversationC.id}/chat`,
    {
      headers: { origin },
      data: { clientMessageId: randomUUID(), content: "Which database is canonical?" },
    },
  );
  expect(chat.status()).toBe(200);
  expect(await chat.text()).toContain("Canonical context includes MySQL.");

  const conversationCMessagesResponse = await request.get(
    `/api/projects/${project.id}/conversations/${conversationC.id}/messages`,
  );
  expect(conversationCMessagesResponse.status()).toBe(200);
  const conversationCMessagesPayload: unknown = await conversationCMessagesResponse.json();
  const conversationCMessages = messageListResponseSchema.parse(conversationCMessagesPayload);
  expect(conversationCMessages).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        role: "assistant",
        deliveryState: "completed",
        content: "Canonical context includes MySQL.",
      }),
    ]),
  );

  const viewerLogin = await request.post("/api/session", {
    headers: { origin },
    data: { apiToken: requiredViewerApiToken() },
  });
  expect(viewerLogin.status()).toBe(200);
  const viewerSessionPayload: unknown = await viewerLogin.json();
  const viewerSession = sessionResponseSchema.parse(viewerSessionPayload);
  const viewerMembersResponse = await request.get(`/api/projects/${project.id}/members`);
  expect(viewerMembersResponse.status()).toBe(200);
  const viewerMembersPayload: unknown = await viewerMembersResponse.json();
  expect(projectMemberListResponseSchema.parse(viewerMembersPayload)).toContainEqual(
    expect.objectContaining({ userId: viewerSession.user.id, role: "viewer" }),
  );
  const deniedWrite = await request.post(`/api/projects/${project.id}/conversations`, {
    headers: { origin },
    data: { title: "Viewer must not create this" },
  });
  expect(deniedWrite.status()).toBe(403);
  const allowedRead = await request.get(`/api/projects/${project.id}/context`);
  expect(allowedRead.status()).toBe(200);
  const viewerContextPayload: unknown = await allowedRead.json();
  expect(contextSnapshotResponseSchema.parse(viewerContextPayload).items).toEqual([
    expect.objectContaining({ key: "database.engine", value: "MySQL" }),
  ]);

  const ownerLogin = await request.post("/api/session", {
    headers: { origin },
    data: { apiToken: requiredApiToken() },
  });
  expect(ownerLogin.status()).toBe(200);
  const readConversation = await request.get(
    `/api/projects/${project.id}/conversations/${conversationC.id}`,
  );
  expect(readConversation.status()).toBe(200);
  expect(
    conversationResponseSchema.parse((await readConversation.json()) as unknown),
  ).toEqual(conversationC);

  const renameConversation = await request.patch(
    `/api/projects/${project.id}/conversations/${conversationC.id}`,
    {
      headers: { origin },
      data: { title: "Archived canonical-context follow-up" },
    },
  );
  expect(renameConversation.status()).toBe(200);
  expect(
    conversationResponseSchema.parse((await renameConversation.json()) as unknown).title,
  ).toBe("Archived canonical-context follow-up");
  const archiveConversation = await request.patch(
    `/api/projects/${project.id}/conversations/${conversationC.id}`,
    { headers: { origin }, data: { archive: true } },
  );
  expect(archiveConversation.status()).toBe(200);
  expect(
    conversationResponseSchema.parse((await archiveConversation.json()) as unknown),
  ).toMatchObject({ status: "archived", archivedAt: expect.any(String) });

  const archiveProject = await request.patch(`/api/projects/${project.id}`, {
    headers: { origin },
    data: { name: `${project.name} archived`, archive: true },
  });
  expect(archiveProject.status()).toBe(200);
  expect(projectResponseSchema.parse((await archiveProject.json()) as unknown)).toMatchObject({
    name: `${project.name} archived`,
    archivedAt: expect.any(String),
  });
});
