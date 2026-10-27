import { projectPath } from "./projects";
export function conversationsPath(projectId: string): string {
  return projectPath(projectId) + "/conversations";
}
