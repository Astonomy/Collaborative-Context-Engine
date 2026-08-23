import {
  branchSchema,
  contextCommitSchema,
  conversationSchema,
  messageSchema,
  projectMemberSchema,
  projectSchema,
  userSchema,
  type ProjectRole,
} from "@cce/domain";
import { FixedClock, InMemoryUnitOfWork, SequenceIdGenerator, Sha256ContentHasher } from "@cce/test-support";

export function uuid(value: number): string {
  return `00000000-0000-4000-8000-${value.toString().padStart(12, "0")}`;
}

export function createFixture(role: ProjectRole = "owner") {
  const unitOfWork = new InMemoryUnitOfWork();
  const user = userSchema.parse({
    id: uuid(1),
    email: "alice@example.test",
    displayName: "Alice",
    createdAt: "2026-08-23T00:00:00.000Z",
  });
  const project = projectSchema.parse({
    id: uuid(2),
    name: "CCE",
    headCommitId: uuid(3),
    version: 0,
    createdBy: user.id,
    createdAt: "2026-08-23T00:00:00.000Z",
    archivedAt: null,
  });
  const genesis = contextCommitSchema.parse({
    id: project.headCommitId,
    projectId: project.id,
    kind: "genesis",
    parentCommitId: null,
    version: 0,
    idempotencyKey: `project-genesis:${project.id}`,
    summary: "Project genesis",
    sourceDeltaIds: [],
    proposedBy: [],
    committedBy: { type: "human", userId: user.id },
    changes: [],
    createdAt: "2026-08-23T00:00:00.000Z",
  });
  const member = projectMemberSchema.parse({
    projectId: project.id,
    userId: user.id,
    role,
    joinedAt: "2026-08-23T00:00:00.000Z",
  });
  unitOfWork.seedUser(user);
  unitOfWork.seedProject(project, member, genesis);
  return {
    unitOfWork,
    user,
    project,
    genesis,
    member,
    clock: new FixedClock(new Date("2026-08-23T01:00:00.000Z")),
    hasher: new Sha256ContentHasher(),
  };
}

export function seedConversation(fixture: ReturnType<typeof createFixture>) {
  const conversation = conversationSchema.parse({
    id: uuid(4),
    projectId: fixture.project.id,
    branchId: uuid(5),
    title: "Architecture",
    status: "active",
    createdBy: { type: "human", userId: fixture.user.id },
    createdAt: "2026-08-23T00:10:00.000Z",
    archivedAt: null,
  });
  const branch = branchSchema.parse({
    id: conversation.branchId,
    projectId: fixture.project.id,
    conversationId: conversation.id,
    baseCommitId: fixture.project.headCommitId,
    status: "open",
    createdAt: "2026-08-23T00:10:00.000Z",
    closedAt: null,
  });
  const message = messageSchema.parse({
    id: uuid(6),
    projectId: fixture.project.id,
    conversationId: conversation.id,
    sequence: 1,
    clientMessageId: uuid(7),
    role: "user",
    deliveryState: "completed",
    content: "We decided to use PostgreSQL.",
    author: { type: "human", userId: fixture.user.id },
    providerMessageId: null,
    errorCode: null,
    createdAt: "2026-08-23T00:11:00.000Z",
    completedAt: "2026-08-23T00:11:00.000Z",
  });
  fixture.unitOfWork.seedConversation(conversation, branch, [message]);
  return { conversation, branch, message };
}

export function idsFrom(start: number, count = 100): SequenceIdGenerator {
  return new SequenceIdGenerator(
    Array.from({ length: count }, (_, index) => uuid(start + index)),
  );
}

