import { z } from "zod";
import { createHandlers as mcpHandlers } from "./handlers/mcp/route";
import { createHandlers as importAttachmentHandlers } from "./handlers/projects/[projectId]/imports/attachments/route";
import type { HttpServices } from "./server/services";
import { createHandlers as healthHandlers } from "./handlers/health/route";
import { createHandlers as projectsHandlers } from "./handlers/projects/route";
import { createHandlers as sessionHandlers } from "./handlers/session/route";
import { createHandlers as projectsByProjectIdHandlers } from "./handlers/projects/[projectId]/route";
import { createHandlers as projectsByProjectIdAuditHandlers } from "./handlers/projects/[projectId]/audit/route";
import { createHandlers as projectsByProjectIdContextHandlers } from "./handlers/projects/[projectId]/context/route";
import { createHandlers as projectsByProjectIdConversationsHandlers } from "./handlers/projects/[projectId]/conversations/route";
import { createHandlers as projectsByProjectIdImportsHandlers } from "./handlers/projects/[projectId]/imports/route";
import { createHandlers as projectsByProjectIdMembersHandlers } from "./handlers/projects/[projectId]/members/route";
import { createHandlers as projectsByProjectIdMergeRequestsHandlers } from "./handlers/projects/[projectId]/merge-requests/route";
import { createHandlers as projectsByProjectIdAgentsRunsHandlers } from "./handlers/projects/[projectId]/agents/runs/route";
import { createHandlers as projectsByProjectIdAttachmentsByAttachmentIdHandlers } from "./handlers/projects/[projectId]/attachments/[attachmentId]/route";
import { createHandlers as projectsByProjectIdContextCommitsHandlers } from "./handlers/projects/[projectId]/context/commits/route";
import { createHandlers as projectsByProjectIdContextItemsHandlers } from "./handlers/projects/[projectId]/context/items/route";
import { createHandlers as projectsByProjectIdConversationsByConversationIdHandlers } from "./handlers/projects/[projectId]/conversations/[conversationId]/route";
import { createHandlers as projectsByProjectIdImportsPreviewHandlers } from "./handlers/projects/[projectId]/imports/preview/route";
import { createHandlers as projectsByProjectIdImportsProviderPreviewsHandlers } from "./handlers/projects/[projectId]/imports/provider-previews/route";
import { createHandlers as projectsByProjectIdImportsProviderSubmissionsHandlers } from "./handlers/projects/[projectId]/imports/provider-submissions/route";
import { createHandlers as projectsByProjectIdImportsByImportIdHandlers } from "./handlers/projects/[projectId]/imports/[importId]/route";
import { createHandlers as projectsByProjectIdMembersByUserIdHandlers } from "./handlers/projects/[projectId]/members/[userId]/route";
import { createHandlers as projectsByProjectIdMergeRequestsByMergeRequestIdHandlers } from "./handlers/projects/[projectId]/merge-requests/[mergeRequestId]/route";
import { createHandlers as projectsByProjectIdAgentsRunsByRunIdHandlers } from "./handlers/projects/[projectId]/agents/runs/[runId]/route";
import { createHandlers as projectsByProjectIdAttachmentsByAttachmentIdContentHandlers } from "./handlers/projects/[projectId]/attachments/[attachmentId]/content/route";
import { createHandlers as projectsByProjectIdAttachmentsByAttachmentIdInspectionHandlers } from "./handlers/projects/[projectId]/attachments/[attachmentId]/inspection/route";
import { createHandlers as projectsByProjectIdConversationsByConversationIdAttachmentsHandlers } from "./handlers/projects/[projectId]/conversations/[conversationId]/attachments/route";
import { createHandlers as projectsByProjectIdConversationsByConversationIdChatHandlers } from "./handlers/projects/[projectId]/conversations/[conversationId]/chat/route";
import { createHandlers as projectsByProjectIdConversationsByConversationIdDeltasHandlers } from "./handlers/projects/[projectId]/conversations/[conversationId]/deltas/route";
import { createHandlers as projectsByProjectIdConversationsByConversationIdExtractHandlers } from "./handlers/projects/[projectId]/conversations/[conversationId]/extract/route";
import { createHandlers as projectsByProjectIdConversationsByConversationIdMessagesHandlers } from "./handlers/projects/[projectId]/conversations/[conversationId]/messages/route";
import { createHandlers as projectsByProjectIdMergeRequestsByMergeRequestIdFinalizeHandlers } from "./handlers/projects/[projectId]/merge-requests/[mergeRequestId]/finalize/route";
import { createHandlers as projectsByProjectIdAgentsRunsByRunIdCancelHandlers } from "./handlers/projects/[projectId]/agents/runs/[runId]/cancel/route";
import { createHandlers as projectsByProjectIdAgentsRunsByRunIdReconcileHandlers } from "./handlers/projects/[projectId]/agents/runs/[runId]/reconcile/route";
import { createHandlers as projectsByProjectIdAgentsRunsByRunIdResumeHandlers } from "./handlers/projects/[projectId]/agents/runs/[runId]/resume/route";
import { createHandlers as projectsByProjectIdMergeRequestsByMergeRequestIdConflictsByConflictIdResolutionHandlers } from "./handlers/projects/[projectId]/merge-requests/[mergeRequestId]/conflicts/[conflictId]/resolution/route";
type Handler = (request: Request, context: { params: Record<string, string> }) => Promise<Response>;
export function createApiRouter(getRuntime: () => HttpServices) {
  const routes: { path: string; handlers: Partial<Record<string, Handler>> }[] = [
    { path: "/mcp", handlers: mcpHandlers(getRuntime) },
    {
      path: "/api/projects/[projectId]/imports/attachments",
      handlers: {
        POST: (request, context) =>
          importAttachmentHandlers(getRuntime).POST(request, {
            params: z.object({ projectId: z.string() }).parse(context.params),
          }),
      },
    },
    { path: "/api/health", handlers: { GET: () => healthHandlers(getRuntime).GET() } },
    {
      path: "/api/projects",
      handlers: {
        GET: (request) => projectsHandlers(getRuntime).GET(request),
        POST: (request) => projectsHandlers(getRuntime).POST(request),
      },
    },
    {
      path: "/api/session",
      handlers: {
        GET: (request) => sessionHandlers(getRuntime).GET(request),
        POST: (request) => sessionHandlers(getRuntime).POST(request),
        DELETE: (request) => sessionHandlers(getRuntime).DELETE(request),
      },
    },
    {
      path: "/api/projects/[projectId]",
      handlers: {
        GET: (request, context) =>
          projectsByProjectIdHandlers(getRuntime).GET(request, {
            params: z.object({ projectId: z.string() }).parse(context.params),
          }),
        PATCH: (request, context) =>
          projectsByProjectIdHandlers(getRuntime).PATCH(request, {
            params: z.object({ projectId: z.string() }).parse(context.params),
          }),
      },
    },
    {
      path: "/api/projects/[projectId]/audit",
      handlers: {
        GET: (request, context) =>
          projectsByProjectIdAuditHandlers(getRuntime).GET(request, {
            params: z.object({ projectId: z.string() }).parse(context.params),
          }),
      },
    },
    {
      path: "/api/projects/[projectId]/context",
      handlers: {
        GET: (request, context) =>
          projectsByProjectIdContextHandlers(getRuntime).GET(request, {
            params: z.object({ projectId: z.string() }).parse(context.params),
          }),
      },
    },
    {
      path: "/api/projects/[projectId]/conversations",
      handlers: {
        GET: (request, context) =>
          projectsByProjectIdConversationsHandlers(getRuntime).GET(request, {
            params: z.object({ projectId: z.string() }).parse(context.params),
          }),
        POST: (request, context) =>
          projectsByProjectIdConversationsHandlers(getRuntime).POST(request, {
            params: z.object({ projectId: z.string() }).parse(context.params),
          }),
      },
    },
    {
      path: "/api/projects/[projectId]/imports",
      handlers: {
        POST: (request, context) =>
          projectsByProjectIdImportsHandlers(getRuntime).POST(request, {
            params: z.object({ projectId: z.string() }).parse(context.params),
          }),
      },
    },
    {
      path: "/api/projects/[projectId]/members",
      handlers: {
        GET: (request, context) =>
          projectsByProjectIdMembersHandlers(getRuntime).GET(request, {
            params: z.object({ projectId: z.string() }).parse(context.params),
          }),
        POST: (request, context) =>
          projectsByProjectIdMembersHandlers(getRuntime).POST(request, {
            params: z.object({ projectId: z.string() }).parse(context.params),
          }),
      },
    },
    {
      path: "/api/projects/[projectId]/merge-requests",
      handlers: {
        GET: (request, context) =>
          projectsByProjectIdMergeRequestsHandlers(getRuntime).GET(request, {
            params: z.object({ projectId: z.string() }).parse(context.params),
          }),
        POST: (request, context) =>
          projectsByProjectIdMergeRequestsHandlers(getRuntime).POST(request, {
            params: z.object({ projectId: z.string() }).parse(context.params),
          }),
      },
    },
    {
      path: "/api/projects/[projectId]/agents/runs",
      handlers: {
        GET: (request, context) =>
          projectsByProjectIdAgentsRunsHandlers(getRuntime).GET(request, {
            params: z.object({ projectId: z.string() }).parse(context.params),
          }),
        POST: (request, context) =>
          projectsByProjectIdAgentsRunsHandlers(getRuntime).POST(request, {
            params: z.object({ projectId: z.string() }).parse(context.params),
          }),
      },
    },
    {
      path: "/api/projects/[projectId]/attachments/[attachmentId]",
      handlers: {
        GET: (request, context) =>
          projectsByProjectIdAttachmentsByAttachmentIdHandlers(getRuntime).GET(request, {
            params: z
              .object({ projectId: z.string(), attachmentId: z.string() })
              .parse(context.params),
          }),
      },
    },
    {
      path: "/api/projects/[projectId]/context/commits",
      handlers: {
        GET: (request, context) =>
          projectsByProjectIdContextCommitsHandlers(getRuntime).GET(request, {
            params: z.object({ projectId: z.string() }).parse(context.params),
          }),
      },
    },
    {
      path: "/api/projects/[projectId]/context/items",
      handlers: {
        GET: (request, context) =>
          projectsByProjectIdContextItemsHandlers(getRuntime).GET(request, {
            params: z.object({ projectId: z.string() }).parse(context.params),
          }),
      },
    },
    {
      path: "/api/projects/[projectId]/conversations/[conversationId]",
      handlers: {
        GET: (request, context) =>
          projectsByProjectIdConversationsByConversationIdHandlers(getRuntime).GET(request, {
            params: z
              .object({ projectId: z.string(), conversationId: z.string() })
              .parse(context.params),
          }),
        PATCH: (request, context) =>
          projectsByProjectIdConversationsByConversationIdHandlers(getRuntime).PATCH(request, {
            params: z
              .object({ projectId: z.string(), conversationId: z.string() })
              .parse(context.params),
          }),
      },
    },
    {
      path: "/api/projects/[projectId]/imports/preview",
      handlers: {
        POST: (request, context) =>
          projectsByProjectIdImportsPreviewHandlers(getRuntime).POST(request, {
            params: z.object({ projectId: z.string() }).parse(context.params),
          }),
      },
    },
    {
      path: "/api/projects/[projectId]/imports/provider-previews",
      handlers: {
        POST: (request, context) =>
          projectsByProjectIdImportsProviderPreviewsHandlers(getRuntime).POST(request, {
            params: z.object({ projectId: z.string() }).parse(context.params),
          }),
      },
    },
    {
      path: "/api/projects/[projectId]/imports/provider-submissions",
      handlers: {
        POST: (request, context) =>
          projectsByProjectIdImportsProviderSubmissionsHandlers(getRuntime).POST(request, {
            params: z.object({ projectId: z.string() }).parse(context.params),
          }),
      },
    },
    {
      path: "/api/projects/[projectId]/imports/[importId]",
      handlers: {
        GET: (request, context) =>
          projectsByProjectIdImportsByImportIdHandlers(getRuntime).GET(request, {
            params: z.object({ projectId: z.string(), importId: z.string() }).parse(context.params),
          }),
      },
    },
    {
      path: "/api/projects/[projectId]/members/[userId]",
      handlers: {
        PUT: (request, context) =>
          projectsByProjectIdMembersByUserIdHandlers(getRuntime).PUT(request, {
            params: z.object({ projectId: z.string(), userId: z.string() }).parse(context.params),
          }),
      },
    },
    {
      path: "/api/projects/[projectId]/merge-requests/[mergeRequestId]",
      handlers: {
        GET: (request, context) =>
          projectsByProjectIdMergeRequestsByMergeRequestIdHandlers(getRuntime).GET(request, {
            params: z
              .object({ projectId: z.string(), mergeRequestId: z.string() })
              .parse(context.params),
          }),
      },
    },
    {
      path: "/api/projects/[projectId]/agents/runs/[runId]",
      handlers: {
        GET: (request, context) =>
          projectsByProjectIdAgentsRunsByRunIdHandlers(getRuntime).GET(request, {
            params: z.object({ projectId: z.string(), runId: z.string() }).parse(context.params),
          }),
      },
    },
    {
      path: "/api/projects/[projectId]/attachments/[attachmentId]/content",
      handlers: {
        GET: (request, context) =>
          projectsByProjectIdAttachmentsByAttachmentIdContentHandlers(getRuntime).GET(request, {
            params: z
              .object({ projectId: z.string(), attachmentId: z.string() })
              .parse(context.params),
          }),
      },
    },
    {
      path: "/api/projects/[projectId]/attachments/[attachmentId]/inspection",
      handlers: {
        GET: (request, context) =>
          projectsByProjectIdAttachmentsByAttachmentIdInspectionHandlers(getRuntime).GET(request, {
            params: z
              .object({ projectId: z.string(), attachmentId: z.string() })
              .parse(context.params),
          }),
      },
    },
    {
      path: "/api/projects/[projectId]/conversations/[conversationId]/attachments",
      handlers: {
        GET: (request, context) =>
          projectsByProjectIdConversationsByConversationIdAttachmentsHandlers(getRuntime).GET(
            request,
            {
              params: z
                .object({ projectId: z.string(), conversationId: z.string() })
                .parse(context.params),
            },
          ),
        POST: (request, context) =>
          projectsByProjectIdConversationsByConversationIdAttachmentsHandlers(getRuntime).POST(
            request,
            {
              params: z
                .object({ projectId: z.string(), conversationId: z.string() })
                .parse(context.params),
            },
          ),
      },
    },
    {
      path: "/api/projects/[projectId]/conversations/[conversationId]/chat",
      handlers: {
        POST: (request, context) =>
          projectsByProjectIdConversationsByConversationIdChatHandlers(getRuntime).POST(request, {
            params: z
              .object({ projectId: z.string(), conversationId: z.string() })
              .parse(context.params),
          }),
      },
    },
    {
      path: "/api/projects/[projectId]/conversations/[conversationId]/deltas",
      handlers: {
        POST: (request, context) =>
          projectsByProjectIdConversationsByConversationIdDeltasHandlers(getRuntime).POST(request, {
            params: z
              .object({ projectId: z.string(), conversationId: z.string() })
              .parse(context.params),
          }),
      },
    },
    {
      path: "/api/projects/[projectId]/conversations/[conversationId]/extract",
      handlers: {
        POST: (request, context) =>
          projectsByProjectIdConversationsByConversationIdExtractHandlers(getRuntime).POST(
            request,
            {
              params: z
                .object({ projectId: z.string(), conversationId: z.string() })
                .parse(context.params),
            },
          ),
      },
    },
    {
      path: "/api/projects/[projectId]/conversations/[conversationId]/messages",
      handlers: {
        GET: (request, context) =>
          projectsByProjectIdConversationsByConversationIdMessagesHandlers(getRuntime).GET(
            request,
            {
              params: z
                .object({ projectId: z.string(), conversationId: z.string() })
                .parse(context.params),
            },
          ),
        POST: (request, context) =>
          projectsByProjectIdConversationsByConversationIdMessagesHandlers(getRuntime).POST(
            request,
            {
              params: z
                .object({ projectId: z.string(), conversationId: z.string() })
                .parse(context.params),
            },
          ),
      },
    },
    {
      path: "/api/projects/[projectId]/merge-requests/[mergeRequestId]/finalize",
      handlers: {
        POST: (request, context) =>
          projectsByProjectIdMergeRequestsByMergeRequestIdFinalizeHandlers(getRuntime).POST(
            request,
            {
              params: z
                .object({ projectId: z.string(), mergeRequestId: z.string() })
                .parse(context.params),
            },
          ),
      },
    },
    {
      path: "/api/projects/[projectId]/agents/runs/[runId]/cancel",
      handlers: {
        POST: (request, context) =>
          projectsByProjectIdAgentsRunsByRunIdCancelHandlers(getRuntime).POST(request, {
            params: z.object({ projectId: z.string(), runId: z.string() }).parse(context.params),
          }),
      },
    },
    {
      path: "/api/projects/[projectId]/agents/runs/[runId]/reconcile",
      handlers: {
        POST: (request, context) =>
          projectsByProjectIdAgentsRunsByRunIdReconcileHandlers(getRuntime).POST(request, {
            params: z.object({ projectId: z.string(), runId: z.string() }).parse(context.params),
          }),
      },
    },
    {
      path: "/api/projects/[projectId]/agents/runs/[runId]/resume",
      handlers: {
        POST: (request, context) =>
          projectsByProjectIdAgentsRunsByRunIdResumeHandlers(getRuntime).POST(request, {
            params: z.object({ projectId: z.string(), runId: z.string() }).parse(context.params),
          }),
      },
    },
    {
      path: "/api/projects/[projectId]/merge-requests/[mergeRequestId]/conflicts/[conflictId]/resolution",
      handlers: {
        PUT: (request, context) =>
          projectsByProjectIdMergeRequestsByMergeRequestIdConflictsByConflictIdResolutionHandlers(
            getRuntime,
          ).PUT(request, {
            params: z
              .object({ projectId: z.string(), mergeRequestId: z.string(), conflictId: z.string() })
              .parse(context.params),
          }),
      },
    },
  ];
  return async (request: Request): Promise<Response> => {
    const segments = new URL(request.url).pathname.split("/");
    for (const route of routes) {
      const pattern = route.path.split("/");
      if (pattern.length !== segments.length) continue;
      const params: Record<string, string> = {};
      if (
        !pattern.every((part, index) => {
          const value = segments[index];
          if (value === undefined) return false;
          if (part.startsWith("[")) {
            params[part.slice(1, -1)] = value;
            return true;
          }
          return part === value;
        })
      )
        continue;
      const handler = route.handlers[request.method];
      if (!handler)
        return new Response(null, {
          status: 405,
          headers: { allow: Object.keys(route.handlers).join(", ") },
        });
      return handler(request, { params });
    }
    return new Response(null, { status: 404 });
  };
}
