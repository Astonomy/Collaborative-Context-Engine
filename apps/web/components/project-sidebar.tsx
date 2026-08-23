"use client";

import type { ProjectAccess } from "@cce/application";
import { useState, type FormEvent, type ReactElement } from "react";

interface ProjectSidebarProps {
  readonly projects: readonly ProjectAccess[];
  readonly selectedProjectId: string | null;
  readonly busy: boolean;
  readonly onSelect: (projectId: ProjectAccess["project"]["id"]) => void;
  readonly onCreate: (name: string) => Promise<void>;
  readonly onUpdate: (
    projectId: ProjectAccess["project"]["id"],
    update: { readonly name?: string; readonly archive?: true },
  ) => Promise<void>;
}

export function ProjectSidebar({
  projects,
  selectedProjectId,
  busy,
  onSelect,
  onCreate,
  onUpdate,
}: ProjectSidebarProps): ReactElement {
  const [name, setName] = useState("");
  const selected = projects.find((access) => access.project.id === selectedProjectId) ?? null;

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    await onCreate(name);
    setName("");
  }

  async function renameSelected(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (selected === null) return;
    const form = new FormData(event.currentTarget);
    const updatedName = form.get("projectName");
    if (typeof updatedName !== "string") return;
    await onUpdate(selected.project.id, { name: updatedName });
  }

  return (
    <aside className="project-sidebar" aria-label="Projects">
      <div className="sidebar-heading">
        <p className="eyebrow">Workspace</p>
        <h2>Projects</h2>
      </div>
      <nav aria-label="Project list" className="project-list">
        {projects.length === 0 ? (
          <p className="empty-copy">No projects yet. Create the first canonical context.</p>
        ) : (
          projects.map(({ project, member }) => (
            <button
              type="button"
              key={project.id}
              className={
                project.id === selectedProjectId ? "project-link selected" : "project-link"
              }
              onClick={() => onSelect(project.id)}
              aria-current={project.id === selectedProjectId ? "page" : undefined}
            >
              <span>{project.name}</span>
              <small>
                {member.role} · {project.archivedAt === null ? `v${project.version}` : "archived"}
              </small>
            </button>
          ))
        )}
      </nav>
      <form className="create-project" onSubmit={(event) => void submit(event)}>
        <label htmlFor="project-name">New project</label>
        <div className="inline-form">
          <input
            id="project-name"
            value={name}
            onChange={(event) => setName(event.target.value)}
            maxLength={160}
            placeholder="Project name"
            required
          />
          <button
            type="submit"
            disabled={busy || name.trim().length === 0}
            aria-label="Create project"
          >
            +
          </button>
        </div>
      </form>
      {selected?.member.role === "owner" ? (
        <section className="project-settings" key={`${selected.project.id}:${selected.project.name}`}>
          <form onSubmit={(event) => void renameSelected(event)}>
            <label htmlFor="selected-project-name">Project name</label>
            <div className="inline-form">
              <input
                id="selected-project-name"
                name="projectName"
                defaultValue={selected.project.name}
                maxLength={160}
                required
                disabled={busy || selected.project.archivedAt !== null}
              />
              <button
                type="submit"
                disabled={busy || selected.project.archivedAt !== null}
              >
                Rename
              </button>
            </div>
          </form>
          <button
            type="button"
            className="danger-button"
            disabled={busy || selected.project.archivedAt !== null}
            onClick={() => void onUpdate(selected.project.id, { archive: true })}
          >
            Archive project
          </button>
        </section>
      ) : null}
    </aside>
  );
}
