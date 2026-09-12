import { createHash, randomUUID } from "node:crypto";

import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { ConversationImportService, ProjectService } from "@cce/application";
import {
  agentRunSchema,
  auditEventSchema,
  branchIdSchema,
  branchSchema,
  commitChangeIdSchema,
  contextCommitIdSchema,
  contextCommitSchema,
  contextDeltaIdSchema,
  contextDeltaSchema,
  contextItemProposalSchema,
  contextItemVersionIdSchema,
  conversationIdSchema,
  conversationSchema,
  deltaChangeIdSchema,
  logicalContextItemIdSchema,
  mergeConflictIdSchema,
  mergeConflictSchema,
  mergeFinalizationSchema,
  mergeRequestIdSchema,
  mergeRequestSchema,
  messageIdSchema,
  messageSchema,
  modelRunSchema,
  projectIdSchema,
  projectMemberSchema,
  projectSchema,
  userIdSchema,
  userSchema,
  type ContextCommit,
  type ContextDelta,
  type ContextItemProposal,
  type Conversation,
  type Message,
  type Project,
  type User,
} from "@cce/domain";
import {
  createPostgresPool,
  hashApiToken,
  PostgresUnitOfWork,
  runMigrations,
  seedDevelopmentIdentity,
  type MigrationResult,
} from "@cce/database";
import { createCceMcpServer } from "@cce/mcp-server";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { z } from "zod";

let container: StartedPostgreSqlContainer | undefined;
type DatabasePool = ReturnType<typeof createPostgresPool>;

let pool: DatabasePool | undefined;
let unitOfWork: PostgresUnitOfWork | undefined;
let initialMigrations: readonly MigrationResult[] | undefined;

function databasePool(): DatabasePool {
  if (pool === undefined) {
    throw new Error("The PostgreSQL integration test container is not running.");
  }
  return pool;
}

function databaseUnitOfWork(): PostgresUnitOfWork {
  if (unitOfWork === undefined) {
    throw new Error("The PostgreSQL integration test unit of work is not ready.");
  }
  return unitOfWork;
}

function timestamp(): string {
  return new Date().toISOString();
}

interface ProjectFixture {
  readonly user: User;
  readonly project: Project;
  readonly genesis: ContextCommit;
}

interface ConversationFixture {
  readonly conversation: Conversation;
  readonly message: Message;
}

interface SemanticFixture extends ProjectFixture, ConversationFixture {
  readonly delta: ContextDelta;
  readonly commit: ContextCommit;
  readonly proposal: ContextItemProposal;
}

async function createProjectFixture(label: string): Promise<ProjectFixture> {
  const now = timestamp();
  const user = userSchema.parse({
    id: userIdSchema.parse(randomUUID()),
    email: `${label}-${randomUUID()}@example.test`,
    displayName: label,
    createdAt: now,
  });
  const projectId = projectIdSchema.parse(randomUUID());
  const genesisId = contextCommitIdSchema.parse(randomUUID());
  const project = projectSchema.parse({
    id: projectId,
    name: `${label} project`,
    headCommitId: genesisId,
    version: 0,
    createdBy: user.id,
    createdAt: now,
    archivedAt: null,
  });
  const genesis = contextCommitSchema.parse({
    id: genesisId,
    projectId,
    kind: "genesis",
    parentCommitId: null,
    version: 0,
    idempotencyKey: `genesis:${projectId}`,
    summary: "Project genesis",
    sourceDeltaIds: [],
    proposedBy: [],
    committedBy: { type: "human", userId: user.id },
    changes: [],
    createdAt: now,
  });
  const member = projectMemberSchema.parse({
    projectId,
    userId: user.id,
    role: "owner",
    joinedAt: now,
  });
  await databaseUnitOfWork().run(async (repositories) => {
    await repositories.identity.insertUser(user);
    await repositories.projects.insert(project);
    await repositories.context.insertCommit(genesis);
    await repositories.projects.insertMember(member);
  });
  return { user, project, genesis };
}

async function createConversationFixture(fixture: ProjectFixture): Promise<ConversationFixture> {
  const now = timestamp();
  const conversationId = conversationIdSchema.parse(randomUUID());
  const branchId = branchIdSchema.parse(randomUUID());
  const conversation = conversationSchema.parse({
    id: conversationId,
    projectId: fixture.project.id,
    branchId,
    title: "Database integration conversation",
    status: "active",
    createdBy: { type: "human", userId: fixture.user.id },
    createdAt: now,
    archivedAt: null,
  });
  const branch = branchSchema.parse({
    id: branchId,
    projectId: fixture.project.id,
    conversationId,
    baseCommitId: fixture.genesis.id,
    status: "open",
    createdAt: now,
    closedAt: null,
  });
  const message = messageSchema.parse({
    id: messageIdSchema.parse(randomUUID()),
    projectId: fixture.project.id,
    conversationId,
    sequence: 1,
    clientMessageId: randomUUID(),
    role: "user",
    deliveryState: "completed",
    content: "The API timeout is thirty seconds.",
    author: { type: "human", userId: fixture.user.id },
    providerMessageId: null,
    errorCode: null,
    createdAt: now,
    completedAt: now,
  });
  await databaseUnitOfWork().run(async (repositories) => {
    await repositories.conversations.insert(conversation, branch);
    expect(
      await repositories.conversations.nextMessageSequence(fixture.project.id, conversation.id),
    ).toBe(1);
    await repositories.conversations.insertMessage(message);
  });
  return { conversation, message };
}

function createDelta(fixture: ProjectFixture & ConversationFixture): {
  readonly delta: ContextDelta;
  readonly proposal: ContextItemProposal;
} {
  const now = timestamp();
  const proposal = contextItemProposalSchema.parse({
    kind: "fact",
    key: "api.timeout",
    value: { seconds: 30 },
    scope: { component: "api", tags: ["runtime"] },
    authority: "authoritative",
    confidence: 0.98,
    provenance: [
      {
        projectId: fixture.project.id,
        conversationId: fixture.conversation.id,
        messageIds: [fixture.message.id],
        actor: { type: "human", userId: fixture.user.id },
        modelRunId: null,
        recordedAt: now,
      },
    ],
    explicitSupersedesVersionId: null,
  });
  const delta = contextDeltaSchema.parse({
    id: contextDeltaIdSchema.parse(randomUUID()),
    projectId: fixture.project.id,
    branchId: fixture.conversation.branchId,
    conversationId: fixture.conversation.id,
    baseCommitId: fixture.genesis.id,
    throughMessageSequence: 1,
    schemaVersion: 1,
    extractorRunId: null,
    revisionOf: null,
    contentHash: createHash("sha256").update(randomUUID()).digest("hex"),
    proposedBy: { type: "human", userId: fixture.user.id },
    createdAt: now,
    changes: [
      {
        id: deltaChangeIdSchema.parse(randomUUID()),
        operation: "add",
        proposal,
      },
    ],
  });
  return { delta, proposal };
}

function createSemanticCommit(
  fixture: ProjectFixture & ConversationFixture,
  delta: ContextDelta,
  proposal: ContextItemProposal,
  provenanceMessageId: Message["id"] = fixture.message.id,
): ContextCommit {
  const now = timestamp();
  const commitId = contextCommitIdSchema.parse(randomUUID());
  const logicalItemId = logicalContextItemIdSchema.parse(randomUUID());
  const deltaChange = delta.changes[0];
  if (deltaChange === undefined || deltaChange.operation !== "add") {
    throw new Error("The semantic fixture requires one add Delta change.");
  }
  return contextCommitSchema.parse({
    id: commitId,
    projectId: fixture.project.id,
    kind: "semantic",
    parentCommitId: fixture.genesis.id,
    version: 1,
    idempotencyKey: `semantic:${commitId}`,
    summary: "Record the API timeout",
    sourceDeltaIds: [delta.id],
    proposedBy: [delta.proposedBy],
    committedBy: { type: "human", userId: fixture.user.id },
    changes: [
      {
        id: commitChangeIdSchema.parse(randomUUID()),
        ordinal: 0,
        operation: "add",
        logicalItemId,
        beforeVersion: null,
        afterVersion: {
          id: contextItemVersionIdSchema.parse(randomUUID()),
          logicalItemId,
          projectId: fixture.project.id,
          commitId,
          previousVersionId: null,
          kind: proposal.kind,
          key: proposal.key,
          value: proposal.value,
          scope: proposal.scope,
          authority: proposal.authority,
          confidence: proposal.confidence,
          provenance: proposal.provenance.map((source) => ({
            ...source,
            messageIds: [provenanceMessageId],
          })),
          lifecycle: "active",
          scopeHash: createHash("sha256").update(JSON.stringify(proposal.scope)).digest("hex"),
          supersedesVersionId: null,
          createdAt: now,
        },
        sourceDeltaId: delta.id,
        sourceDeltaChangeId: deltaChange.id,
      },
    ],
    createdAt: now,
  });
}

async function createSemanticFixture(label: string): Promise<SemanticFixture> {
  const projectFixture = await createProjectFixture(label);
  const conversationFixture = await createConversationFixture(projectFixture);
  const base = { ...projectFixture, ...conversationFixture };
  const { delta, proposal } = createDelta(base);
  await databaseUnitOfWork().run((repositories) => repositories.context.insertDelta(delta));
  const commit = createSemanticCommit(base, delta, proposal);
  await databaseUnitOfWork().run(async (repositories) => {
    await repositories.context.insertCommit(commit);
    await repositories.context.applyProjectionChanges(projectFixture.project.id, commit.changes);
    expect(
      await repositories.projects.advanceHead(
        projectFixture.project.id,
        projectFixture.genesis.id,
        commit.id,
        1,
      ),
    ).toBe(true);
  });
  return { ...base, delta, commit, proposal };
}

beforeAll(async () => {
  container = await new PostgreSqlContainer("postgres:18.6-alpine3.24")
    .withDatabase("cce_integration")
    .withUsername("cce")
    .withPassword("cce-integration")
    .start();
  pool = createPostgresPool(container.getConnectionUri(), { max: 8 });
  unitOfWork = new PostgresUnitOfWork(pool);
  initialMigrations = await runMigrations(pool);
}, 120_000);

afterAll(async () => {
  if (pool !== undefined) {
    await pool.end();
  }
  if (container !== undefined) {
    await container.stop();
  }
});

describe("PostgreSQL 18 persistence", () => {
  it("migrates an empty PostgreSQL 18.6 database and records an immutable checksum", async () => {
    expect(initialMigrations).toEqual([
      { name: "0001_initial.sql", status: "applied" },
      { name: "0002_conversation_imports.sql", status: "applied" },
      { name: "0003_provider_conversation_previews.sql", status: "applied" },
      { name: "0004_remove_zip_conversation_import.sql", status: "applied" },
    ]);
    const version = await databasePool().query<{ readonly server_version: string }>(
      "SHOW server_version",
    );
    expect(version.rows[0]?.server_version).toMatch(/^18\.6(?:\s|$)/);
    const importConstraints = await databasePool().query<{ readonly definition: string }>(
      `SELECT pg_get_constraintdef(oid) AS definition
       FROM pg_constraint
       WHERE conname IN ('conversation_imports_source_format', 'conversation_imports_source_shape')
       ORDER BY conname`,
    );
    expect(importConstraints.rows).toHaveLength(2);
    expect(importConstraints.rows.every(({ definition }) => !definition.includes("'zip'"))).toBe(
      true,
    );
    await expect(runMigrations(databasePool())).resolves.toEqual(
      [
        "0001_initial.sql",
        "0002_conversation_imports.sql",
        "0003_provider_conversation_previews.sql",
        "0004_remove_zip_conversation_import.sql",
      ].map((name) => ({ name, status: "already_applied" })),
    );
  });

  it("persists approved provider captures atomically and project-scopes preview access", async () => {
    const first = await createProjectFixture("Provider capture A");
    const second = await createProjectFixture("Provider capture B");
    const service = new ConversationImportService(
      databaseUnitOfWork(),
      { next: () => randomUUID() },
      { now: () => new Date() },
    );
    const server = createCceMcpServer({
      actorUserId: first.user.id,
      projects: new ProjectService(
        databaseUnitOfWork(),
        { next: () => randomUUID() },
        { now: () => new Date() },
      ),
      conversationImports: service,
    });
    const client = new Client({ name: "cce-postgres-integration", version: "0.1.0" });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
    const previewResult = await client.callTool({
      name: "preview_conversation_import",
      arguments: {
        projectId: first.project.id,
        source: "codex",
        captureScope: "partial",
        externalConversationId: "codex-session-supplied-by-client",
        title: "PostgreSQL provider import",
        messages: [
          {
            externalMessageId: "provider-message-supplied-by-client",
            role: "assistant",
            content: [{ type: "text", text: "Conversation evidence, not canonical state." }],
            metadata: {},
          },
        ],
        metadata: { surface: "codex" },
      },
    });
    const preview = z
      .object({ previewId: z.uuid() })
      .transform(({ previewId }) => ({ id: previewId }))
      .parse(previewResult.structuredContent);

    expect(
      await databaseUnitOfWork().run((repositories) =>
        repositories.imports.findPreviewById(second.project.id, preview.id),
      ),
    ).toBeNull();
    const crossProject = await client.callTool({
      name: "submit_conversation_import",
      arguments: { projectId: second.project.id, previewId: preview.id },
    });
    expect(crossProject).toMatchObject({ isError: true });
    const crossProjectError = z
      .array(z.object({ type: z.literal("text"), text: z.string() }))
      .min(1)
      .parse(crossProject.content)[0];
    if (crossProjectError === undefined) throw new Error("Expected an MCP error response.");
    expect(crossProjectError.text).toContain("NOT_FOUND");

    const submitResult = await client.callTool({
      name: "submit_conversation_import",
      arguments: { projectId: first.project.id, previewId: preview.id },
    });
    const imported = z.object({ importId: z.uuid() }).parse(submitResult.structuredContent);
    await client.close();
    await server.close();
    const loaded = await databaseUnitOfWork().run((repositories) =>
      repositories.imports.findById(first.project.id, imported.importId),
    );
    expect(loaded).toMatchObject({
      source: "codex-plugin",
      sourceFormat: "mcp",
      policy: "provided_messages",
      conversationCount: 1,
      messageCount: 1,
      createdBy: first.user.id,
    });
    expect(loaded?.sourceManifest[0]?.metadata).toMatchObject({
      importedBy: first.user.id,
      previewId: preview.id,
    });
    const persistedProject = await databaseUnitOfWork().run((repositories) =>
      repositories.projects.findById(first.project.id),
    );
    expect(persistedProject?.headCommitId).toBe(first.genesis.id);
    await expect(
      databasePool().query(
        "UPDATE conversation_imports SET message_count = message_count + 1 WHERE project_id = $1 AND id = $2",
        [first.project.id, imported.importId],
      ),
    ).rejects.toMatchObject({ code: "55000" });
  });

  it("rolls back failed units of work and seeds only a SHA-256 token hash", async () => {
    const rolledBackUser = userSchema.parse({
      id: userIdSchema.parse(randomUUID()),
      email: `rollback-${randomUUID()}@example.test`,
      displayName: "Rollback",
      createdAt: timestamp(),
    });
    await expect(
      databaseUnitOfWork().run(async (repositories) => {
        await repositories.identity.insertUser(rolledBackUser);
        throw new Error("force rollback");
      }),
    ).rejects.toThrow("force rollback");
    await expect(
      databaseUnitOfWork().run((repositories) =>
        repositories.identity.findUserById(rolledBackUser.id),
      ),
    ).resolves.toBeNull();

    const rawToken = `integration-${randomUUID()}`;
    const email = `seed-${randomUUID()}@example.test`;
    const first = await seedDevelopmentIdentity(databaseUnitOfWork(), {
      email,
      displayName: "Seed User",
      apiToken: rawToken,
    });
    const second = await seedDevelopmentIdentity(databaseUnitOfWork(), {
      email,
      displayName: "Seed User",
      apiToken: rawToken,
    });
    expect(first.userCreated).toBe(true);
    expect(first.tokenCreated).toBe(true);
    expect(second.userCreated).toBe(false);
    expect(second.tokenCreated).toBe(false);

    const stored = await databasePool().query<{ readonly token_hash: string }>(
      "SELECT token_hash FROM api_tokens WHERE user_id = $1",
      [first.user.id],
    );
    expect(stored.rows[0]?.token_hash.trim()).toBe(hashApiToken(rawToken));
    expect(stored.rows[0]?.token_hash).not.toContain(rawToken);
  });

  it("enforces project scoping with composite foreign keys and rolls back the whole write", async () => {
    const first = await createProjectFixture("Scope A");
    const second = await createProjectFixture("Scope B");
    const now = timestamp();
    const conversationId = conversationIdSchema.parse(randomUUID());
    const branchId = branchIdSchema.parse(randomUUID());
    const conversation = conversationSchema.parse({
      id: conversationId,
      projectId: first.project.id,
      branchId,
      title: "Cross-project attempt",
      status: "active",
      createdBy: { type: "human", userId: first.user.id },
      createdAt: now,
      archivedAt: null,
    });
    const branch = branchSchema.parse({
      id: branchId,
      projectId: first.project.id,
      conversationId,
      baseCommitId: second.genesis.id,
      status: "open",
      createdAt: now,
      closedAt: null,
    });

    await expect(
      databaseUnitOfWork().run((repositories) =>
        repositories.conversations.insert(conversation, branch),
      ),
    ).rejects.toThrow();
    await expect(
      databaseUnitOfWork().run((repositories) =>
        repositories.conversations.find(first.project.id, conversation.id),
      ),
    ).resolves.toBeNull();
    await expect(
      databaseUnitOfWork().run((repositories) => repositories.projects.findById(second.project.id)),
    ).resolves.toEqual(second.project);
  });

  it("serializes concurrent message sequences and makes terminal messages immutable", async () => {
    const fixture = await createProjectFixture("Message isolation");
    const conversationFixture = await createConversationFixture(fixture);
    const append = async (content: string): Promise<Message> =>
      databaseUnitOfWork().run(async (repositories) => {
        const sequence = await repositories.conversations.nextMessageSequence(
          fixture.project.id,
          conversationFixture.conversation.id,
        );
        const now = timestamp();
        const message = messageSchema.parse({
          id: messageIdSchema.parse(randomUUID()),
          projectId: fixture.project.id,
          conversationId: conversationFixture.conversation.id,
          sequence,
          clientMessageId: randomUUID(),
          role: "user",
          deliveryState: "completed",
          content,
          author: { type: "human", userId: fixture.user.id },
          providerMessageId: null,
          errorCode: null,
          createdAt: now,
          completedAt: now,
        });
        await repositories.conversations.insertMessage(message);
        return message;
      });

    const concurrentMessages = await Promise.all([append("Second"), append("Third")]);
    expect(concurrentMessages.map((message) => message.sequence).sort()).toEqual([2, 3]);

    const streaming = await databaseUnitOfWork().run(async (repositories) => {
      const sequence = await repositories.conversations.nextMessageSequence(
        fixture.project.id,
        conversationFixture.conversation.id,
      );
      const pending = messageSchema.parse({
        id: messageIdSchema.parse(randomUUID()),
        projectId: fixture.project.id,
        conversationId: conversationFixture.conversation.id,
        sequence,
        clientMessageId: null,
        role: "assistant",
        deliveryState: "pending",
        content: "",
        author: { type: "human", userId: fixture.user.id },
        providerMessageId: null,
        errorCode: null,
        createdAt: timestamp(),
        completedAt: null,
      });
      await repositories.conversations.insertMessage(pending);
      const completed = messageSchema.parse({
        ...pending,
        deliveryState: "completed",
        content: "Stream complete",
        completedAt: timestamp(),
      });
      await repositories.conversations.updateStreamingMessage(completed);
      return completed;
    });

    await expect(
      databaseUnitOfWork().run((repositories) =>
        repositories.conversations.updateStreamingMessage({
          ...streaming,
          content: "Attempted rewrite",
        }),
      ),
    ).rejects.toThrow("terminal");
    const stored = await databaseUnitOfWork().run((repositories) =>
      repositories.conversations.listMessages(
        fixture.project.id,
        conversationFixture.conversation.id,
      ),
    );
    expect(stored.map((message) => message.sequence)).toEqual([1, 2, 3, 4]);
    expect(stored[3]?.content).toBe("Stream complete");
  });

  it("commits context atomically, preserves provenance, snapshots history, and CAS-updates HEAD", async () => {
    const fixture = await createSemanticFixture("Semantic");
    const result = await databaseUnitOfWork().run(async (repositories) => ({
      project: await repositories.projects.findById(fixture.project.id),
      branch: await repositories.conversations.findBranch(
        fixture.project.id,
        fixture.conversation.branchId,
      ),
      delta: await repositories.context.findDelta(fixture.project.id, fixture.delta.id),
      commit: await repositories.context.findCommitByIdempotencyKey(
        fixture.project.id,
        fixture.commit.idempotencyKey,
      ),
      current: await repositories.context.listCurrentItems(fixture.project.id),
      snapshot: await repositories.context.getHeadSnapshot(fixture.project.id),
      staleCas: await repositories.projects.advanceHead(
        fixture.project.id,
        fixture.genesis.id,
        fixture.commit.id,
        1,
      ),
    }));
    expect(result.project?.headCommitId).toBe(fixture.commit.id);
    expect(result.project?.version).toBe(1);
    expect(result.branch?.baseCommitId).toBe(fixture.genesis.id);
    expect(result.delta).toEqual(fixture.delta);
    expect(result.commit).toEqual(fixture.commit);
    expect(result.current).toEqual([fixture.commit.changes[0]?.afterVersion]);
    expect(result.snapshot?.ancestorCommitIds).toContain(fixture.genesis.id);
    expect(result.snapshot?.appliedDeltaIds).toEqual([fixture.delta.id]);
    expect(result.snapshot?.items[0]?.provenance[0]?.messageIds).toEqual([fixture.message.id]);
    expect(result.staleCas).toBe(false);

    await expect(
      databasePool().query(
        "UPDATE context_commits SET summary = $1 WHERE project_id = $2 AND id = $3",
        ["mutated", fixture.project.id, fixture.commit.id],
      ),
    ).rejects.toMatchObject({ code: "55000" });
  });

  it("allows one commit to deprecate an authoritative slot and add its active replacement", async () => {
    const fixture = await createSemanticFixture("Slot replacement");
    const current = fixture.commit.changes[0]?.afterVersion;
    const sourceChange = fixture.delta.changes[0];
    if (current === undefined || sourceChange === undefined) {
      throw new Error("The replacement fixture requires one committed ContextItem and source.");
    }
    const now = timestamp();
    const commitId = contextCommitIdSchema.parse(randomUUID());
    const replacementLineageId = logicalContextItemIdSchema.parse(randomUUID());
    const replacement = contextCommitSchema.parse({
      id: commitId,
      projectId: fixture.project.id,
      kind: "semantic",
      parentCommitId: fixture.commit.id,
      version: 2,
      idempotencyKey: `semantic:${commitId}`,
      summary: "Replace the active authoritative timeout lineage",
      sourceDeltaIds: [fixture.delta.id],
      proposedBy: [fixture.delta.proposedBy],
      committedBy: { type: "human", userId: fixture.user.id },
      changes: [
        {
          id: commitChangeIdSchema.parse(randomUUID()),
          ordinal: 0,
          operation: "deprecate",
          logicalItemId: current.logicalItemId,
          beforeVersion: current,
          afterVersion: {
            ...current,
            id: contextItemVersionIdSchema.parse(randomUUID()),
            commitId,
            previousVersionId: current.id,
            lifecycle: "deprecated",
            createdAt: now,
          },
          sourceDeltaId: fixture.delta.id,
          sourceDeltaChangeId: sourceChange.id,
        },
        {
          id: commitChangeIdSchema.parse(randomUUID()),
          ordinal: 1,
          operation: "add",
          logicalItemId: replacementLineageId,
          beforeVersion: null,
          afterVersion: {
            ...current,
            id: contextItemVersionIdSchema.parse(randomUUID()),
            logicalItemId: replacementLineageId,
            commitId,
            previousVersionId: null,
            value: { seconds: 45 },
            lifecycle: "active",
            supersedesVersionId: null,
            createdAt: now,
          },
          sourceDeltaId: fixture.delta.id,
          sourceDeltaChangeId: sourceChange.id,
        },
      ],
      createdAt: now,
    });

    await databaseUnitOfWork().run(async (repositories) => {
      await repositories.context.insertCommit(replacement);
      await repositories.context.applyProjectionChanges(fixture.project.id, replacement.changes);
      expect(
        await repositories.projects.advanceHead(
          fixture.project.id,
          fixture.commit.id,
          replacement.id,
          replacement.version,
        ),
      ).toBe(true);
    });

    const currentItems = await databaseUnitOfWork().run((repositories) =>
      repositories.context.listCurrentItems(fixture.project.id),
    );
    expect(currentItems).toHaveLength(2);
    expect(currentItems).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          logicalItemId: current.logicalItemId,
          lifecycle: "deprecated",
        }),
        expect.objectContaining({
          logicalItemId: replacementLineageId,
          lifecycle: "active",
          value: { seconds: 45 },
        }),
      ]),
    );
  });

  it("rejects a semantic commit whose message provenance crosses conversations without residue", async () => {
    const firstProject = await createProjectFixture("Atomic A");
    const firstConversation = await createConversationFixture(firstProject);
    const secondProject = await createProjectFixture("Atomic B");
    const secondConversation = await createConversationFixture(secondProject);
    const base = { ...firstProject, ...firstConversation };
    const { delta, proposal } = createDelta(base);
    await databaseUnitOfWork().run((repositories) => repositories.context.insertDelta(delta));
    const invalidCommit = createSemanticCommit(
      base,
      delta,
      proposal,
      secondConversation.message.id,
    );

    await expect(
      databaseUnitOfWork().run(async (repositories) => {
        await repositories.context.insertCommit(invalidCommit);
        await repositories.context.applyProjectionChanges(
          firstProject.project.id,
          invalidCommit.changes,
        );
      }),
    ).rejects.toThrow();

    const residue = await databasePool().query<{ readonly count: string }>(
      `SELECT count(*)
       FROM context_item_versions
       WHERE project_id = $1 AND commit_id = $2`,
      [firstProject.project.id, invalidCommit.id],
    );
    expect(residue.rows[0]?.count).toBe("0");
    await expect(
      databaseUnitOfWork().run((repositories) =>
        repositories.context.findCommitByIdempotencyKey(
          firstProject.project.id,
          invalidCommit.idempotencyKey,
        ),
      ),
    ).resolves.toBeNull();
  });

  it("round-trips merge, run, and append-only audit repositories within project scope", async () => {
    const fixture = await createSemanticFixture("Repositories");
    const now = timestamp();
    const modelRun = modelRunSchema.parse({
      id: randomUUID(),
      projectId: fixture.project.id,
      conversationId: fixture.conversation.id,
      provider: "test-provider",
      model: "test-model",
      purpose: "classification",
      promptId: "classification",
      promptVersion: 1,
      inputHash: "a".repeat(64),
      status: "running",
      inputTokens: null,
      cachedTokens: null,
      outputTokens: null,
      latencyMs: null,
      errorCode: null,
      createdAt: now,
      completedAt: null,
    });
    const agentRun = agentRunSchema.parse({
      id: randomUUID(),
      projectId: fixture.project.id,
      agentName: "review",
      status: "queued",
      version: 0,
      state: { step: 1 },
      createdAt: now,
      updatedAt: now,
    });
    const request = mergeRequestSchema.parse({
      id: mergeRequestIdSchema.parse(randomUUID()),
      projectId: fixture.project.id,
      branchId: fixture.conversation.branchId,
      deltaId: fixture.delta.id,
      baseCommitId: fixture.genesis.id,
      evaluatedHeadCommitId: fixture.commit.id,
      resultingCommitId: null,
      status: "draft",
      createdBy: { type: "human", userId: fixture.user.id },
      createdAt: now,
      updatedAt: now,
    });
    const deltaChange = fixture.delta.changes[0];
    if (deltaChange === undefined) {
      throw new Error("The merge fixture requires one Delta change.");
    }
    const conflict = mergeConflictSchema.parse({
      id: mergeConflictIdSchema.parse(randomUUID()),
      projectId: fixture.project.id,
      mergeRequestId: request.id,
      deltaChangeId: deltaChange.id,
      classification: "C2",
      baseVersion: null,
      currentVersion: fixture.commit.changes[0]?.afterVersion ?? null,
      proposed: fixture.proposal,
      reason: "The scopes require review.",
      requiresHumanReview: true,
      resolution: null,
      createdAt: now,
    });
    const audit = auditEventSchema.parse({
      id: randomUUID(),
      projectId: fixture.project.id,
      actor: { type: "human", userId: fixture.user.id },
      action: "integration.checked",
      targetType: "project",
      targetId: fixture.project.id,
      metadata: { source: "integration" },
      occurredAt: now,
    });

    await databaseUnitOfWork().run(async (repositories) => {
      await repositories.runs.insertModelRun(modelRun);
      await repositories.runs.updateModelRun({
        ...modelRun,
        status: "completed",
        inputTokens: 10,
        cachedTokens: 2,
        outputTokens: 3,
        latencyMs: 25,
        completedAt: timestamp(),
      });
      await repositories.runs.insertAgentRun(agentRun);
      await repositories.runs.updateAgentRun(
        {
          ...agentRun,
          status: "running",
          version: 1,
          state: { step: 2 },
          updatedAt: timestamp(),
        },
        0,
      );
      await repositories.merges.insert(request, [conflict]);
      await repositories.merges.saveResolution(fixture.project.id, conflict.id, {
        choice: "keep_current",
        editedProposal: null,
        rationale: "The committed value remains canonical.",
        resolvedBy: fixture.user.id,
        resolvedAt: timestamp(),
      });
      await repositories.merges.updateRequest({
        ...request,
        status: "rejected",
        updatedAt: timestamp(),
      });
      await repositories.merges.insertFinalization(
        mergeFinalizationSchema.parse({
          projectId: fixture.project.id,
          mergeRequestId: request.id,
          operationKey: `merge:${request.id}:${"a".repeat(64)}`,
          outcome: "no_changes",
          resultingCommitId: null,
          finalizedAt: timestamp(),
        }),
      );
      await repositories.audit.append(audit);
    });

    const loaded = await databaseUnitOfWork().run(async (repositories) => ({
      model: await repositories.runs.findModelRun(fixture.project.id, modelRun.id),
      agent: await repositories.runs.findAgentRun(fixture.project.id, agentRun.id),
      request: await repositories.merges.find(fixture.project.id, request.id),
      finalization: await repositories.merges.findFinalization(fixture.project.id, request.id),
      conflicts: await repositories.merges.listConflicts(fixture.project.id, request.id),
      crossProjectRequest: await repositories.merges.find(
        projectIdSchema.parse(randomUUID()),
        request.id,
      ),
    }));
    expect(loaded.model?.status).toBe("completed");
    expect(loaded.agent?.status).toBe("running");
    expect(loaded.agent?.state).toEqual({ step: 2 });
    expect(loaded.request?.status).toBe("rejected");
    expect(loaded.finalization).toMatchObject({
      mergeRequestId: request.id,
      outcome: "no_changes",
      resultingCommitId: null,
    });
    expect(loaded.conflicts[0]?.resolution?.choice).toBe("keep_current");
    expect(loaded.crossProjectRequest).toBeNull();

    await expect(
      databasePool().query(
        `UPDATE model_runs
         SET status = 'failed', error_code = 'rewritten', completed_at = now()
         WHERE project_id = $1 AND id = $2`,
        [fixture.project.id, modelRun.id],
      ),
    ).rejects.toMatchObject({ code: "55000" });

    await expect(
      databasePool().query(
        `UPDATE agent_runs
         SET version = version + 2, updated_at = now()
         WHERE project_id = $1 AND id = $2`,
        [fixture.project.id, agentRun.id],
      ),
    ).rejects.toMatchObject({ code: "55000" });

    const loadedAgent = loaded.agent;
    if (loadedAgent === null) {
      throw new Error("The persisted AgentRun was not found.");
    }
    await expect(
      databaseUnitOfWork().run((repositories) =>
        repositories.runs.updateAgentRun(
          {
            ...loadedAgent,
            status: "completed",
            version: loadedAgent.version + 1,
            updatedAt: timestamp(),
          },
          loadedAgent.version,
        ),
      ),
    ).resolves.toBe(true);
    await expect(
      databasePool().query(
        `UPDATE agent_runs
         SET status = 'cancelled', version = version + 1, updated_at = now()
         WHERE project_id = $1 AND id = $2`,
        [fixture.project.id, agentRun.id],
      ),
    ).rejects.toMatchObject({ code: "55000" });

    await expect(
      databasePool().query(
        "UPDATE merge_finalizations SET finalized_at = now() WHERE project_id = $1 AND merge_request_id = $2",
        [fixture.project.id, request.id],
      ),
    ).rejects.toMatchObject({ code: "55000" });

    await expect(
      databasePool().query("DELETE FROM audit_events WHERE project_id = $1 AND id = $2", [
        audit.projectId,
        audit.id,
      ]),
    ).rejects.toMatchObject({ code: "55000" });
  });
});
