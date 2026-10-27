import { projectPath } from "./projects";
export function agentsPath(projectId: string): string {
  return projectPath(projectId) + "/agents/runs";
}
