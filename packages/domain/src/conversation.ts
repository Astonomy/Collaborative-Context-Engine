import { z } from "zod";

import { actorSchema } from "./actor";
import { dateTimeSchema } from "./datetime";
import { DomainError } from "./errors";
import {
  branchIdSchema,
  contextCommitIdSchema,
  conversationIdSchema,
  messageIdSchema,
  projectIdSchema,
} from "./ids";

export const conversationStatusSchema = z.enum(["active", "archived"]);
export const branchStatusSchema = z.enum(["open", "merged", "abandoned"]);
export const messageRoleSchema = z.enum(["system", "user", "assistant", "tool"]);
export const messageDeliveryStateSchema = z.enum([
  "pending",
  "streaming",
  "completed",
  "interrupted",
  "failed",
]);

export const conversationSchema = z
  .object({
    id: conversationIdSchema,
    projectId: projectIdSchema,
    branchId: branchIdSchema,
    title: z.string().trim().min(1).max(200),
    status: conversationStatusSchema,
    createdBy: actorSchema,
    createdAt: dateTimeSchema,
    archivedAt: dateTimeSchema.nullable(),
  })
  .strict()
  .superRefine((conversation, context) => {
    if (conversation.status === "archived" && conversation.archivedAt === null) {
      context.addIssue({
        code: "custom",
        message: "An archived conversation requires archivedAt.",
        path: ["archivedAt"],
      });
    }
    if (conversation.status === "active" && conversation.archivedAt !== null) {
      context.addIssue({
        code: "custom",
        message: "An active conversation cannot have archivedAt.",
        path: ["archivedAt"],
      });
    }
  });

export type Conversation = z.infer<typeof conversationSchema>;

export const branchSchema = z
  .object({
    id: branchIdSchema,
    projectId: projectIdSchema,
    conversationId: conversationIdSchema,
    baseCommitId: contextCommitIdSchema,
    status: branchStatusSchema,
    createdAt: dateTimeSchema,
    closedAt: dateTimeSchema.nullable(),
  })
  .strict()
  .superRefine((branch, context) => {
    if (branch.status === "open" && branch.closedAt !== null) {
      context.addIssue({ code: "custom", message: "An open branch cannot have closedAt." });
    }
    if (branch.status !== "open" && branch.closedAt === null) {
      context.addIssue({ code: "custom", message: "A closed branch requires closedAt." });
    }
  });

export type Branch = z.infer<typeof branchSchema>;

export const messageSchema = z
  .object({
    id: messageIdSchema,
    projectId: projectIdSchema,
    conversationId: conversationIdSchema,
    sequence: z.int().positive().max(2_147_483_647),
    clientMessageId: z.uuid().nullable(),
    replyToMessageId: messageIdSchema.nullable().default(null),
    role: messageRoleSchema,
    deliveryState: messageDeliveryStateSchema,
    content: z.string().max(1_000_000),
    author: actorSchema,
    providerMessageId: z.string().trim().min(1).max(500).nullable(),
    errorCode: z.string().trim().min(1).max(100).nullable(),
    createdAt: dateTimeSchema,
    completedAt: dateTimeSchema.nullable(),
  })
  .strict()
  .superRefine((message, context) => {
    const isTerminal = ["completed", "interrupted", "failed"].includes(message.deliveryState);
    if (isTerminal !== (message.completedAt !== null)) {
      context.addIssue({
        code: "custom",
        message: "Terminal message state and completedAt must be set together.",
        path: ["completedAt"],
      });
    }
    if (message.deliveryState === "completed" && message.content.trim().length === 0) {
      context.addIssue({
        code: "custom",
        message: "A completed message must contain content.",
        path: ["content"],
      });
    }
    if (message.role === "user" && message.clientMessageId === null) {
      context.addIssue({
        code: "custom",
        message: "A user message requires a clientMessageId for idempotency.",
        path: ["clientMessageId"],
      });
    }
    if (message.replyToMessageId !== null && message.role !== "assistant") {
      context.addIssue({
        code: "custom",
        message: "Only an assistant message can identify the user message it replies to.",
        path: ["replyToMessageId"],
      });
    }
  });

export type Message = z.infer<typeof messageSchema>;
export type MessageDeliveryState = z.infer<typeof messageDeliveryStateSchema>;

const messageTransitions: Readonly<Record<MessageDeliveryState, readonly MessageDeliveryState[]>> = {
  pending: ["streaming", "completed", "failed"],
  streaming: ["completed", "interrupted", "failed"],
  completed: [],
  interrupted: [],
  failed: [],
};

export function assertMessageTransition(
  current: MessageDeliveryState,
  next: MessageDeliveryState,
): void {
  if (!messageTransitions[current].includes(next)) {
    throw new DomainError(
      "INVALID_STATE_TRANSITION",
      `Message cannot transition from ${current} to ${next}.`,
    );
  }
}

export function assertBranchTransition(
  current: Branch["status"],
  next: Branch["status"],
): void {
  if (current !== "open" || next === "open") {
    throw new DomainError(
      "INVALID_STATE_TRANSITION",
      `Branch cannot transition from ${current} to ${next}.`,
    );
  }
}
