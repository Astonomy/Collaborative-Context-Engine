import { createRouter, createWebHistory, type RouterHistory, type Router } from "vue-router";
import type { Session } from "./data/session";

export function appRouter(
  session: Session,
  base: string,
  report: (error: unknown) => void,
  history: RouterHistory = createWebHistory(base),
): Router {
  const router = createRouter({
    history,
    routes: [
      { path: "/", redirect: "/projects" },
      { path: "/login", name: "login", component: () => import("./views/LoginView.vue") },
      {
        path: "/projects",
        name: "projects",
        component: () => import("./views/ProjectsView.vue"),
        meta: { authenticated: true },
      },
      {
        path: "/projects/:projectId",
        component: () => import("./views/ProjectView.vue"),
        meta: { authenticated: true },
        children: [
          {
            path: "attachments/:attachmentId",
            name: "attachment",
            component: () => import("./views/AttachmentView.vue"),
          },
          { path: "", name: "project", component: () => import("./views/ProjectOverview.vue") },
          {
            path: "conversations",
            name: "conversations",
            component: () => import("./views/ConversationsView.vue"),
          },
          {
            path: "conversations/:conversationId",
            name: "conversation",
            component: () => import("./views/ConversationView.vue"),
          },
          { path: "context", name: "context", component: () => import("./views/ContextView.vue") },
          { path: "history", name: "history", component: () => import("./views/HistoryView.vue") },
          {
            path: "merges/:mergeId?",
            name: "merges",
            component: () => import("./views/MergeView.vue"),
          },
        ],
      },
      { path: "/:pathMatch(.*)*", component: () => import("./views/NotFoundView.vue") },
    ],
  });
  router.beforeEach(async (to) => {
    try {
      await session.bootstrap();
    } catch (error: unknown) {
      report(error);
      return false;
    }
    if (to.meta["authenticated"] && !session.user.value) return { name: "login" };
    if (to.name === "login" && session.user.value) return { name: "projects" };
    return true;
  });
  router.onError(report);
  return router;
}
