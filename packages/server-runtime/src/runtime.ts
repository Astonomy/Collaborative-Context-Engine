import { createHash, randomUUID } from "node:crypto";
import { isAbsolute, resolve } from "node:path";
import { LocalAttachmentStorage } from "@cce/storage";
import { HeaderMediaInspector } from "@cce/storage/media-server";

import {
  ChatService,
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
  type UnitOfWork,
} from "@cce/application";
import { ScopedAgentService } from "@cce/agents";
import { createPostgresPool, PostgresUnitOfWork } from "@cce/database/runtime";
import { loadQwenVllmProviderConfiguration, QwenVllmModelProvider } from "@cce/model-provider";
import type { Clock, ContentHasher, IdGenerator } from "@cce/shared";
import { z } from "zod";

const serverEnvironmentSchema = z
  .object({
    DATABASE_URL: z
      .string()
      .url()
      .refine((url) => url.startsWith("postgresql://") || url.startsWith("postgres://")),
    CCE_ATTACHMENT_STORAGE_DIRECTORY: z
      .string()
      .trim()
      .min(1)
      .refine(isAbsolute, "Attachment storage directory must be absolute.")
      .optional(),
    NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  })
  .passthrough()
  .refine(
    (value) =>
      value.NODE_ENV !== "production" || value.CCE_ATTACHMENT_STORAGE_DIRECTORY !== undefined,
    "Production requires CCE_ATTACHMENT_STORAGE_DIRECTORY on persistent private storage.",
  );

const systemIds: IdGenerator = { next: () => randomUUID() };
const systemClock: Clock = { now: () => new Date() };
const sha256Hasher: ContentHasher = {
  sha256: (value) => createHash("sha256").update(value, "utf8").digest("hex"),
};

export interface ApplicationRuntime {
  readonly pool: ReturnType<typeof createPostgresPool>;
  readonly attachments: AttachmentService;
  readonly media: MediaProcessingService;
  readonly unitOfWork: UnitOfWork;
  readonly close: () => Promise<void>;
  readonly projects: ProjectService;
  readonly conversations: ConversationService;
  readonly conversationImports: ConversationImportService;
  readonly contexts: ContextService;
  readonly extraction: ExtractionService;
  readonly merges: MergeService;
  readonly chat: ChatService;
  readonly audit: AuditService;
  readonly sessions: SessionService;
  readonly agents: ScopedAgentService;
}

/** Explicit server environment; no ambient secret loading or process singleton. */
export function createApplicationRuntime(
  environment: Readonly<Record<string, string | undefined>>,
  workingDirectory: string,
): ApplicationRuntime {
  const parsed = serverEnvironmentSchema.parse(environment);
  const provider = new QwenVllmModelProvider(loadQwenVllmProviderConfiguration(environment));
  const pool = createPostgresPool(parsed.DATABASE_URL, {
    max: 20,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
    application_name: "cce-web",
  });
  const unitOfWork = new PostgresUnitOfWork(pool);
  const contexts = new ContextService(unitOfWork);
  const conversations = new ConversationService(unitOfWork, systemIds, systemClock);

  const agents = new ScopedAgentService(unitOfWork, contexts, provider, {
    ids: systemIds,
    clock: systemClock,
    contentHasher: sha256Hasher,
  });

  const attachments = new AttachmentService(
    unitOfWork,
    new LocalAttachmentStorage(
      parsed.CCE_ATTACHMENT_STORAGE_DIRECTORY ??
        resolve(workingDirectory, "../../.cce-attachments"),
    ),
    systemIds,
    systemClock,
  );
  return {
    pool,
    attachments,
    media: new MediaProcessingService(attachments, new HeaderMediaInspector()),
    unitOfWork,
    close: () => pool.end(),
    projects: new ProjectService(unitOfWork, systemIds, systemClock),
    conversations,
    conversationImports: new ConversationImportService(unitOfWork, systemIds, systemClock),
    contexts,
    extraction: new ExtractionService(unitOfWork, provider, systemIds, systemClock, sha256Hasher),
    merges: new MergeService(unitOfWork, systemIds, systemClock, sha256Hasher),
    chat: new ChatService(
      unitOfWork,
      conversations,
      contexts,
      provider,
      systemIds,
      systemClock,
      sha256Hasher,
    ),
    audit: new AuditService(unitOfWork),
    sessions: new SessionService(unitOfWork, sha256Hasher),
    agents,
  };
}
