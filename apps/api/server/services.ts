import type {
  AttachmentService,
  MediaProcessingService,
  AuditService,
  ContextService,
  ConversationService,
  ConversationImportService,
  ExtractionService,
  MergeService,
  ProjectService,
  SessionService,
  ChatService,
  UnitOfWork,
} from "@cce/application";
import type { ScopedAgentService } from "@cce/agents";
import type { SessionCookieCodec } from "./session-cookie";

export interface HttpServices {
  readonly pool: { query(sql: string): Promise<unknown> };
  readonly attachments: Pick<AttachmentService, keyof AttachmentService>;
  readonly media: Pick<MediaProcessingService, keyof MediaProcessingService>;
  readonly unitOfWork: UnitOfWork;
  readonly sessionCookie: Pick<SessionCookieCodec, keyof SessionCookieCodec>;
  readonly secureCookies: boolean;
  readonly projects: Pick<ProjectService, keyof ProjectService>;
  readonly conversations: Pick<ConversationService, keyof ConversationService>;
  readonly conversationImports: Pick<ConversationImportService, keyof ConversationImportService>;
  readonly contexts: Pick<ContextService, keyof ContextService>;
  readonly extraction: Pick<ExtractionService, keyof ExtractionService>;
  readonly merges: Pick<MergeService, keyof MergeService>;
  readonly chat: Pick<ChatService, keyof ChatService>;
  readonly audit: Pick<AuditService, keyof AuditService>;
  readonly sessions: Pick<SessionService, keyof SessionService>;
  readonly agents: Pick<ScopedAgentService, keyof ScopedAgentService>;
}
