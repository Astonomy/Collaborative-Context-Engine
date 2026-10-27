import { getMergeRequestDetail, listMergeRequests, listProjectMembers } from "@cce/application";
import { mergeRequestIdSchema, userIdSchema } from "@cce/domain";
import { describe, expect, it } from "vitest";
import { createFixture, uuid } from "./fixtures";

describe("application-owned project queries", () => {
  it("returns project-scoped members, merges and missing detail", async () => {
    const f = createFixture();
    expect(await listProjectMembers(f.unitOfWork, f.project.id, f.user.id)).toEqual([f.member]);
    expect(await listMergeRequests(f.unitOfWork, f.project.id, f.user.id)).toEqual([]);
    expect(
      await getMergeRequestDetail(
        f.unitOfWork,
        f.project.id,
        mergeRequestIdSchema.parse(uuid(900)),
        f.user.id,
      ),
    ).toBeNull();
  });
  it("authorizes before querying each project collection or detail", async () => {
    const f = createFixture();
    const stranger = userIdSchema.parse(uuid(999));
    for (const query of [
      () => listProjectMembers(f.unitOfWork, f.project.id, stranger),
      () => listMergeRequests(f.unitOfWork, f.project.id, stranger),
      () =>
        getMergeRequestDetail(
          f.unitOfWork,
          f.project.id,
          mergeRequestIdSchema.parse(uuid(900)),
          stranger,
        ),
    ])
      await expect(query()).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});
