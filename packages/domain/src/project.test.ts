import { describe, expect, it } from "vitest";

import { DomainError } from "./errors";
import { projectIdSchema, userIdSchema } from "./ids";
import { assertCanChangeMemberRole, projectSchema, type ProjectMember } from "./project";

const projectId = projectIdSchema.parse("00000000-0000-4000-8000-000000000001");
const aliceId = userIdSchema.parse("00000000-0000-4000-8000-000000000002");
const bobId = userIdSchema.parse("00000000-0000-4000-8000-000000000003");

function member(userId: ProjectMember["userId"], role: ProjectMember["role"]): ProjectMember {
  return { projectId, userId, role, joinedAt: "2026-08-23T00:00:00.000Z" };
}

describe("Project invariants", () => {
  it("rejects removing or demoting the final project owner", () => {
    expect(() => assertCanChangeMemberRole([member(aliceId, "owner")], aliceId, "editor"))
      .toThrowError(DomainError);
    expect(() => assertCanChangeMemberRole([member(aliceId, "owner")], aliceId, null)).toThrow(
      "at least one owner",
    );
  });

  it("allows an owner change when another owner remains", () => {
    expect(() =>
      assertCanChangeMemberRole(
        [member(aliceId, "owner"), member(bobId, "owner")],
        aliceId,
        "viewer",
      ),
    ).not.toThrow();
  });

  it("rejects a role change for a missing member", () => {
    expect(() => assertCanChangeMemberRole([member(aliceId, "owner")], bobId, "viewer")).toThrow(
      "does not exist",
    );
  });

  it("validates project names and versions", () => {
    const result = projectSchema.safeParse({
      id: projectId,
      name: " ",
      headCommitId: "00000000-0000-4000-8000-000000000004",
      version: -1,
      createdBy: aliceId,
      createdAt: "2026-08-23T00:00:00.000Z",
      archivedAt: null,
    });
    expect(result.success).toBe(false);
  });
});

