import { createHash, randomUUID } from "node:crypto";

import {
  ChatService,
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

import { SessionCookieCodec } from "./session-cookie";

const webEnvironmentSchema = z
  .object({
    DATABASE_URL: z
      .string()
      .url()
      .refine((url) => url.startsWith("postgresql://") || url.startsWith("postgres://")),
    CCE_SESSION_SECRET: z.string().min(32).max(4_096),
    NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  })
  .passthrough();

const systemIds: IdGenerator = { next: () => randomUUID() };
const systemClock: Clock = { now: () => new Date() };
const sha256Hasher: ContentHasher = {
  sha256: (value) => createHash("sha256").update(value, "utf8").digest("hex"),
};

let runtimeSingleton: WebRuntime | undefined;

export interface WebRuntime {
  readonly pool: ReturnType<typeof createPostgresPool>;
  readonly unitOfWork: UnitOfWork;
  readonly sessionCookie: SessionCookieCodec;
  readonly secureCookies: boolean;
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

export function createWebRuntime(
  environment: Readonly<Record<string, string | undefined>>,
): WebRuntime {
  const parsed = webEnvironmentSchema.parse(environment);
  const pool = createPostgresPool(parsed.DATABASE_URL, {
    max: 20,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
    application_name: "cce-web",
  });
  const unitOfWork = new PostgresUnitOfWork(pool);
  const provider = new QwenVllmModelProvider(loadQwenVllmProviderConfiguration(environment));
  const contexts = new ContextService(unitOfWork);
  const conversations = new ConversationService(unitOfWork, systemIds, systemClock);

  const agents = new ScopedAgentService(unitOfWork, contexts, provider, {
    ids: systemIds,
    clock: systemClock,
    contentHasher: sha256Hasher,
  });

  return {
    pool,
    unitOfWork,
    sessionCookie: new SessionCookieCodec(parsed.CCE_SESSION_SECRET),
    secureCookies: parsed.NODE_ENV === "production",
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

export function getWebRuntime(): WebRuntime {
  runtimeSingleton ??= createWebRuntime(process.env);
  return runtimeSingleton;
}
