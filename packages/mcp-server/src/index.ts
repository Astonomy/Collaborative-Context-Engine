import {
  ApplicationError,
  type ConversationImportService,
  type ProjectService,
} from "@cce/application";
import { providerConversationSubmissionSchema } from "@cce/conversation-import";
import { projectIdSchema, type UserId } from "@cce/domain";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { z } from "zod";

export interface CceMcpDependencies {
  readonly actorUserId: UserId;
  readonly projects: Pick<ProjectService, "list">;
  readonly conversationImports: Pick<
    ConversationImportService,
    "previewProviderSubmission" | "submitProviderPreview"
  >;
}

const projectOutput = {
  id: projectIdSchema,
  name: z.string(),
  role: z.enum(["owner", "editor", "viewer"]),
  archived: z.boolean(),
};

const previewOutput = {
  previewId: z.uuid(),
  source: z.enum(["chatgpt-plugin", "codex-plugin"]),
  targetProject: z.object({ id: projectIdSchema, name: z.string() }),
  operation: z.enum(["create", "append"]),
  targetConversationId: z.uuid().optional(),
  title: z.string(),
  summary: z.string().optional(),
  messageCount: z.number().int().positive(),
  unsupportedContentCount: z.number().int().nonnegative(),
  warnings: z.array(z.string()),
  duplicateStatus: z.enum(["none", "duplicate"]),
  duplicateImportId: z.uuid().optional(),
  duplicateConversationId: z.uuid().optional(),
  expiresAt: z.string().datetime(),
};

const submitOutput = {
  importId: z.uuid(),
  conversationId: z.uuid(),
  projectId: projectIdSchema,
  messageCount: z.number().int().nonnegative(),
  warnings: z.array(z.string()),
};

export function createCceMcpServer(dependencies: CceMcpDependencies): McpServer {
  const server = new McpServer(
    { name: "collaborative-context-engine", version: "0.1.0" },
    {
      instructions:
        "Submit conversation evidence only after an explicit user request. Resolve project IDs with list_projects, preview first, and submit only after required approval. Submission never updates canonical Project Context.",
    },
  );

  server.registerTool(
    "list_projects",
    {
      title: "List CCE projects",
      description:
        "List projects visible to the authenticated CCE user. Use this before previewing an import; never invent a project ID. An optional name filters by exact case-insensitive project name and may return multiple candidates.",
      inputSchema: { name: z.string().trim().min(1).max(160).optional() },
      outputSchema: { projects: z.array(z.object(projectOutput)) },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        openWorldHint: false,
        idempotentHint: true,
      },
    },
    async ({ name }) => {
      const visible = await dependencies.projects.list(dependencies.actorUserId);
      const normalizedName = name?.toLowerCase();
      const projects = visible
        .filter(
          ({ project }) =>
            normalizedName === undefined || project.name.toLowerCase() === normalizedName,
        )
        .map(({ project, member }) => ({
          id: project.id,
          name: project.name,
          role: member.role,
          archived: project.archivedAt !== null,
        }));
      return {
        structuredContent: { projects },
        content: [{ type: "text", text: `Found ${projects.length} visible CCE project(s).` }],
      };
    },
  );

  server.registerTool(
    "preview_conversation_import",
    {
      title: "Preview conversation import",
      description:
        "Validate a user-authorized conversation capture for one exact CCE project. For another submission from the same provider conversation, pass the latest successful previousImportId and only new messages: the preview targets the existing CCE Conversation. Original references remain unchanged. This creates only an expiring plan, not evidence or Project Context changes.",
      inputSchema: providerConversationSubmissionSchema.extend({ projectId: projectIdSchema }),
      outputSchema: previewOutput,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        openWorldHint: false,
        idempotentHint: false,
      },
    },
    async ({ projectId, ...submission }) =>
      mcpOperation(async () => {
        const preview = await dependencies.conversationImports.previewProviderSubmission({
          projectId,
          actorUserId: dependencies.actorUserId,
          submission,
        });
        const structuredContent = {
          previewId: preview.id,
          source: preview.source,
          targetProject: preview.targetProject,
          operation: preview.operation,
          ...(preview.targetConversationId
            ? { targetConversationId: preview.targetConversationId }
            : {}),
          title: preview.title,
          ...(preview.summary ? { summary: preview.summary } : {}),
          messageCount: preview.messageCount,
          unsupportedContentCount: preview.unsupportedContentCount,
          warnings: [...preview.warnings],
          duplicateStatus: preview.duplicateStatus,
          ...(preview.duplicateImportId ? { duplicateImportId: preview.duplicateImportId } : {}),
          ...(preview.duplicateConversationId
            ? { duplicateConversationId: preview.duplicateConversationId }
            : {}),
          expiresAt: preview.expiresAt,
        };
        return {
          structuredContent,
          content: [
            {
              type: "text" as const,
              text: `Preview ${preview.id}: ${preview.messageCount} message(s) for ${preview.targetProject.name}; ${preview.warnings.length} warning(s).`,
            },
          ],
        };
      }),
  );

  server.registerTool(
    "submit_conversation_import",
    {
      title: "Submit conversation to CCE",
      description:
        "Persist the approved preview as evidence. An append preview adds only the supplied delta messages to its existing Conversation; a create preview creates a Conversation. Keep the returned importId for the next delta in this provider conversation. Call only after approval of the destination, message count, and warnings. Project Context is not updated.",
      inputSchema: { projectId: projectIdSchema, previewId: z.uuid() },
      outputSchema: submitOutput,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        openWorldHint: false,
        idempotentHint: true,
      },
    },
    async ({ projectId, previewId }) =>
      mcpOperation(async () => {
        const imported = await dependencies.conversationImports.submitProviderPreview({
          projectId,
          actorUserId: dependencies.actorUserId,
          previewId,
        });
        const conversationId = imported.importedConversations[0]?.conversationId;
        if (conversationId === undefined) {
          throw new ApplicationError("CONFLICT", "Import completed without a conversation.");
        }
        const structuredContent = {
          importId: imported.id,
          conversationId,
          projectId: imported.projectId,
          messageCount: imported.messageCount,
          warnings: [...imported.warnings],
        };
        return {
          structuredContent,
          content: [
            {
              type: "text" as const,
              text: `Stored ${imported.messageCount} message(s) as CCE conversation evidence ${conversationId}. Project Context was not updated.`,
            },
          ],
        };
      }),
  );

  return server;
}

export async function handleCceMcpRequest(
  request: Request,
  dependencies: CceMcpDependencies,
  parsedBody?: unknown,
): Promise<Response> {
  const transport = new WebStandardStreamableHTTPServerTransport({
    enableJsonResponse: true,
  });
  const server = createCceMcpServer(dependencies);
  await server.connect(transport);
  return transport.handleRequest(request, { parsedBody });
}

async function mcpOperation<T>(operation: () => Promise<T>): Promise<T | McpErrorResult> {
  try {
    return await operation();
  } catch (error: unknown) {
    if (error instanceof ApplicationError) {
      return {
        isError: true,
        content: [{ type: "text", text: `${error.code}: ${error.message}` }],
      };
    }
    throw error;
  }
}

interface McpErrorResult {
  [key: string]: unknown;
  readonly isError: true;
  readonly content: [{ type: "text"; text: string }];
}
