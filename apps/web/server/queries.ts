import { authorizeProjectMember, type UnitOfWork } from "@cce/application";
import type { MergeConflict, MergeRequest, ProjectId, ProjectMember, UserId } from "@cce/domain";

export async function listProjectMembers(
  unitOfWork: UnitOfWork,
  projectId: ProjectId,
  actorUserId: UserId,
): Promise<readonly ProjectMember[]> {
  return unitOfWork.run(async (repositories) => {
    const access = await repositories.projects.findAccess(projectId, actorUserId);
    authorizeProjectMember(access?.member ?? null, actorUserId, "project:read");
    return repositories.projects.listMembers(projectId);
  });
}

export async function listMergeRequests(
  unitOfWork: UnitOfWork,
  projectId: ProjectId,
  actorUserId: UserId,
): Promise<readonly MergeRequest[]> {
  return unitOfWork.run(async (repositories) => {
    const access = await repositories.projects.findAccess(projectId, actorUserId);
    authorizeProjectMember(access?.member ?? null, actorUserId, "project:read");
    return repositories.merges.list(projectId);
  });
}

export async function getMergeRequestDetail(
  unitOfWork: UnitOfWork,
  projectId: ProjectId,
  mergeRequestId: MergeRequest["id"],
  actorUserId: UserId,
): Promise<{
  readonly request: MergeRequest;
  readonly conflicts: readonly MergeConflict[];
} | null> {
  return unitOfWork.run(async (repositories) => {
    const access = await repositories.projects.findAccess(projectId, actorUserId);
    authorizeProjectMember(access?.member ?? null, actorUserId, "project:read");
    const request = await repositories.merges.find(projectId, mergeRequestId);
    if (request === null) {
      return null;
    }
    const conflicts = await repositories.merges.listConflicts(projectId, mergeRequestId);
    return { request, conflicts };
  });
}
