import { projectPath } from "./projects";
export function contextPath(projectId: string): string {
  return projectPath(projectId) + "/context";
}
