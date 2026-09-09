import type { Project, ProjectMember, ProjectRole, UserId } from "@cce/domain";

import { ApplicationError } from "./errors";

export type ProjectPermission =
  | "project:read"
  | "conversation:write"
  | "conversation:import"
  | "context:propose"
  | "context:review_low_risk"
  | "context:approve_high_risk"
  | "member:manage"
  | "project:archive"
  | "agent:run";

const permissionsByRole: Readonly<Record<ProjectRole, ReadonlySet<ProjectPermission>>> = {
  viewer: new Set(["project:read"]),
  editor: new Set([
    "project:read",
    "conversation:write",
    "conversation:import",
    "context:propose",
    "context:review_low_risk",
    "agent:run",
  ]),
  owner: new Set([
    "project:read",
    "conversation:write",
    "conversation:import",
    "context:propose",
    "context:review_low_risk",
    "context:approve_high_risk",
    "member:manage",
    "project:archive",
    "agent:run",
  ]),
};

export function hasProjectPermission(role: ProjectRole, permission: ProjectPermission): boolean {
  return permissionsByRole[role].has(permission);
}

export function authorizeProjectMember(
  member: ProjectMember | null,
  actorUserId: UserId,
  permission: ProjectPermission,
): ProjectMember {
  if (member === null || member.userId !== actorUserId) {
    throw new ApplicationError("NOT_FOUND", "Project was not found.");
  }
  if (!hasProjectPermission(member.role, permission)) {
    throw new ApplicationError(
      "FORBIDDEN",
      `The ${member.role} role does not grant ${permission}.`,
    );
  }
  return member;
}

export function requireActiveProject(project: Project): void {
  if (project.archivedAt !== null) {
    throw new ApplicationError("CONFLICT", "The archived project is read-only.");
  }
}
