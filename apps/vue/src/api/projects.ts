export const projectsPath = "/api/projects";
export function projectPath(id: string): string {
  return `${projectsPath}/${encodeURIComponent(id)}`;
}
