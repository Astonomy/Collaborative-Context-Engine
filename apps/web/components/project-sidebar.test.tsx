// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";

import { projectMemberSchema, projectSchema } from "@cce/domain";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ProjectSidebar } from "./project-sidebar";

afterEach(cleanup);

const project = projectSchema.parse({
  id: "00000000-0000-4000-8000-000000000001",
  name: "CCE",
  headCommitId: "00000000-0000-4000-8000-000000000002",
  version: 0,
  createdBy: "00000000-0000-4000-8000-000000000003",
  createdAt: "2026-08-23T00:00:00.000Z",
  archivedAt: null,
});

function access(role: "owner" | "viewer") {
  return {
    project,
    member: projectMemberSchema.parse({
      projectId: project.id,
      userId: project.createdBy,
      role,
      joinedAt: project.createdAt,
    }),
  };
}

describe("ProjectSidebar lifecycle controls", () => {
  it("lets an Owner rename and archive the selected project", async () => {
    const user = userEvent.setup();
    const onUpdate = vi.fn<
      (
        projectId: typeof project.id,
        update: { readonly name?: string; readonly archive?: true },
      ) => Promise<void>
    >().mockResolvedValue();
    render(
      <ProjectSidebar
        projects={[access("owner")]}
        selectedProjectId={project.id}
        busy={false}
        onSelect={() => undefined}
        onCreate={() => Promise.resolve()}
        onUpdate={onUpdate}
      />,
    );

    const name = screen.getByLabelText("Project name");
    await user.clear(name);
    await user.type(name, "CCE Platform");
    await user.click(screen.getByRole("button", { name: "Rename" }));
    expect(onUpdate).toHaveBeenCalledWith(project.id, { name: "CCE Platform" });

    await user.click(screen.getByRole("button", { name: "Archive project" }));
    expect(onUpdate).toHaveBeenCalledWith(project.id, { archive: true });
  });

  it("does not expose project mutation controls to a Viewer", () => {
    render(
      <ProjectSidebar
        projects={[access("viewer")]}
        selectedProjectId={project.id}
        busy={false}
        onSelect={() => undefined}
        onCreate={() => Promise.resolve()}
        onUpdate={() => Promise.resolve()}
      />,
    );

    expect(screen.queryByLabelText("Project name")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Archive project" })).not.toBeInTheDocument();
  });
});
