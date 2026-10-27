import { conversationsPath } from "./conversations";
export function conversationPath(projectId: string, conversationId: string): string {
  return conversationsPath(projectId) + "/" + encodeURIComponent(conversationId);
}
export function messagesPath(projectId: string, conversationId: string): string {
  return conversationPath(projectId, conversationId) + "/messages";
}
