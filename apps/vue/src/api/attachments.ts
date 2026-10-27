import { projectPath } from "./projects";
export function attachmentsPath(projectId: string): string {
  return projectPath(projectId) + "/attachments";
}
