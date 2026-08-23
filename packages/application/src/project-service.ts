import type { Clock, IdGenerator } from "@cce/shared";
import {
  assertCanChangeMemberRole,
  auditEventIdSchema,
  contextCommitIdSchema,
  contextCommitSchema,
  projectIdSchema,
  projectMemberSchema,
  projectSchema,
  type Project,
  type ProjectRole,
  type UserId,
} from "@cce/domain";

import { authorizeProjectMember, requireActiveProject } from "./authorization";
import { ApplicationError } from "./errors";
import type { ProjectAccess, UnitOfWork } from "./repositories";

export interface CreateProjectInput {
  readonly name: string;
  readonly actorUserId: UserId;
}

export class ProjectService {
  public constructor(
    private readonly unitOfWork: UnitOfWork,
    private readonly ids: IdGenerator,
    private readonly clock: Clock,
  ) {}

  public async create(input: CreateProjectInput): Promise<Project> {
    const projectId = projectIdSchema.parse(this.ids.next());
    const commitId = contextCommitIdSchema.parse(this.ids.next());
    const eventId = auditEventIdSchema.parse(this.ids.next());
    const now = this.clock.now().toISOString();
    const project = projectSchema.parse({
      id: projectId,
      name: input.name,
      headCommitId: commitId,
      version: 0,
      createdBy: input.actorUserId,
      createdAt: now,
      archivedAt: null,
    });
    const genesis = contextCommitSchema.parse({
      id: commitId,
      projectId,
      kind: "genesis",
      parentCommitId: null,
      version: 0,
      idempotencyKey: `project-genesis:${projectId}`,
      summary: "Project genesis",
      sourceDeltaIds: [],
      proposedBy: [],
      committedBy: { type: "human", userId: input.actorUserId },
      changes: [],
      createdAt: now,
    });
    const owner = projectMemberSchema.parse({
      projectId,
      userId: input.actorUserId,
      role: "owner",
      joinedAt: now,
    });

    await this.unitOfWork.run(async (repositories) => {
      const actor = await repositories.identity.findUserById(input.actorUserId);
      if (actor === null) {
        throw new ApplicationError("UNAUTHENTICATED", "Authenticated user no longer exists.");
      }
      await repositories.projects.insert(project);
      await repositories.context.insertCommit(genesis);
      await repositories.projects.insertMember(owner);
      await repositories.audit.append({
        id: eventId,
        projectId,
        actor: { type: "human", userId: input.actorUserId },
        action: "project.created",
        targetType: "project",
        targetId: projectId,
        metadata: { name: project.name },
        occurredAt: now,
      });
    });
    return project;
  }

  public async list(actorUserId: UserId): Promise<readonly ProjectAccess[]> {
    return this.unitOfWork.run((repositories) => repositories.projects.listForUser(actorUserId));
  }

  public async get(projectId: Project["id"], actorUserId: UserId): Promise<ProjectAccess> {
    return this.unitOfWork.run(async (repositories) => {
      const access = await repositories.projects.findAccess(projectId, actorUserId);
      authorizeProjectMember(access?.member ?? null, actorUserId, "project:read");
      if (access === null) {
        throw new ApplicationError("NOT_FOUND", "Project was not found.");
      }
      return access;
    });
  }

  public async update(input: {
    readonly projectId: Project["id"];
    readonly actorUserId: UserId;
    readonly name?: string;
    readonly archive?: true;
  }): Promise<Project> {
    if (input.name === undefined && input.archive !== true) {
      throw new ApplicationError("VALIDATION", "A project update requires a name or archive action.");
    }
    const now = this.clock.now().toISOString();
    const eventId = auditEventIdSchema.parse(this.ids.next());
    return this.unitOfWork.run(async (repositories) => {
      const project = await repositories.projects.lockById(input.projectId);
      if (project === null) {
        throw new ApplicationError("NOT_FOUND", "Project was not found.");
      }
      const access = await repositories.projects.findAccess(input.projectId, input.actorUserId);
      authorizeProjectMember(access?.member ?? null, input.actorUserId, "project:archive");
      if (project.archivedAt !== null && input.name !== undefined && input.name !== project.name) {
        throw new ApplicationError("CONFLICT", "An archived project cannot be renamed.");
      }
      const updated = projectSchema.parse({
        ...project,
        name: input.name ?? project.name,
        archivedAt: input.archive === true ? (project.archivedAt ?? now) : project.archivedAt,
      });
      if (updated.name === project.name && updated.archivedAt === project.archivedAt) {
        return project;
      }
      await repositories.projects.updateDetails(updated);
      await repositories.audit.append({
        id: eventId,
        projectId: input.projectId,
        actor: { type: "human", userId: input.actorUserId },
        action: "project.updated",
        targetType: "project",
        targetId: input.projectId,
        metadata: {
          previousName: project.name,
          name: updated.name,
          archived: project.archivedAt === null && updated.archivedAt !== null,
        },
        occurredAt: now,
      });
      return updated;
    });
  }

  public async addMember(input: {
    readonly projectId: Project["id"];
    readonly actorUserId: UserId;
    readonly memberEmail: string;
    readonly role: ProjectRole;
  }): Promise<void> {
    const now = this.clock.now().toISOString();
    const eventId = auditEventIdSchema.parse(this.ids.next());
    await this.unitOfWork.run(async (repositories) => {
      const project = await repositories.projects.lockById(input.projectId);
      if (project === null) {
        throw new ApplicationError("NOT_FOUND", "Project was not found.");
      }
      const access = await repositories.projects.findAccess(input.projectId, input.actorUserId);
      authorizeProjectMember(access?.member ?? null, input.actorUserId, "member:manage");
      requireActiveProject(project);
      const user = await repositories.identity.findUserByEmail(input.memberEmail);
      if (user === null) {
        throw new ApplicationError("NOT_FOUND", "The invited user does not exist.");
      }
      await repositories.projects.insertMember(
        projectMemberSchema.parse({
          projectId: input.projectId,
          userId: user.id,
          role: input.role,
          joinedAt: now,
        }),
      );
      await repositories.audit.append({
        id: eventId,
        projectId: input.projectId,
        actor: { type: "human", userId: input.actorUserId },
        action: "project.member_added",
        targetType: "user",
        targetId: user.id,
        metadata: { role: input.role },
        occurredAt: now,
      });
    });
  }

  public async changeMemberRole(input: {
    readonly projectId: Project["id"];
    readonly actorUserId: UserId;
    readonly targetUserId: UserId;
    readonly role: ProjectRole;
  }): Promise<void> {
    const now = this.clock.now().toISOString();
    const eventId = auditEventIdSchema.parse(this.ids.next());
    await this.unitOfWork.run(async (repositories) => {
      const project = await repositories.projects.lockById(input.projectId);
      if (project === null) {
        throw new ApplicationError("NOT_FOUND", "Project was not found.");
      }
      const access = await repositories.projects.findAccess(input.projectId, input.actorUserId);
      authorizeProjectMember(access?.member ?? null, input.actorUserId, "member:manage");
      requireActiveProject(project);
      const members = await repositories.projects.listMembers(input.projectId);
      assertCanChangeMemberRole(members, input.targetUserId, input.role);
      const current = members.find((member) => member.userId === input.targetUserId);
      if (current === undefined) {
        throw new ApplicationError("NOT_FOUND", "Project member was not found.");
      }
      await repositories.projects.updateMemberRole({ ...current, role: input.role });
      await repositories.audit.append({
        id: eventId,
        projectId: input.projectId,
        actor: { type: "human", userId: input.actorUserId },
        action: "project.member_role_changed",
        targetType: "user",
        targetId: input.targetUserId,
        metadata: { from: current.role, to: input.role },
        occurredAt: now,
      });
    });
  }
}
