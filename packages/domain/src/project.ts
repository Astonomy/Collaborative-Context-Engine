import { z } from "zod";

import { dateTimeSchema } from "./datetime";
import { DomainError } from "./errors";
import { contextCommitIdSchema, projectIdSchema, userIdSchema } from "./ids";

export const projectRoleSchema = z.enum(["owner", "editor", "viewer"]);
export type ProjectRole = z.infer<typeof projectRoleSchema>;

export const userSchema = z
  .object({
    id: userIdSchema,
    email: z.email().max(320),
    displayName: z.string().trim().min(1).max(120),
    createdAt: dateTimeSchema,
  })
  .strict();

export type User = z.infer<typeof userSchema>;

export const projectSchema = z
  .object({
    id: projectIdSchema,
    name: z.string().trim().min(1).max(160),
    headCommitId: contextCommitIdSchema,
    version: z.int().nonnegative(),
    createdBy: userIdSchema,
    createdAt: dateTimeSchema,
    archivedAt: dateTimeSchema.nullable(),
  })
  .strict();

export type Project = z.infer<typeof projectSchema>;

export const projectMemberSchema = z
  .object({
    projectId: projectIdSchema,
    userId: userIdSchema,
    role: projectRoleSchema,
    joinedAt: dateTimeSchema,
  })
  .strict();

export type ProjectMember = z.infer<typeof projectMemberSchema>;

export function assertCanChangeMemberRole(
  members: readonly ProjectMember[],
  targetUserId: ProjectMember["userId"],
  nextRole: ProjectRole | null,
): void {
  const target = members.find((member) => member.userId === targetUserId);
  if (target === undefined) {
    throw new DomainError("INVARIANT_VIOLATION", "The project member does not exist.");
  }

  if (target.role !== "owner" || nextRole === "owner") {
    return;
  }

  const otherOwnerExists = members.some(
    (member) => member.userId !== targetUserId && member.role === "owner",
  );
  if (!otherOwnerExists) {
    throw new DomainError("LAST_OWNER", "A project must retain at least one owner.");
  }
}

