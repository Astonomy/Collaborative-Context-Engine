import { jsonValueSchema } from "@cce/shared";
import { z } from "zod";

import { actorSchema } from "./actor";
import { dateTimeSchema } from "./datetime";
import { auditEventIdSchema, projectIdSchema } from "./ids";

export const auditEventSchema = z
  .object({
    id: auditEventIdSchema,
    projectId: projectIdSchema,
    actor: actorSchema,
    action: z.string().trim().min(1).max(160),
    targetType: z.string().trim().min(1).max(100),
    targetId: z.string().uuid(),
    metadata: z.record(z.string(), jsonValueSchema),
    occurredAt: dateTimeSchema,
  })
  .strict();

export type AuditEvent = z.infer<typeof auditEventSchema>;

