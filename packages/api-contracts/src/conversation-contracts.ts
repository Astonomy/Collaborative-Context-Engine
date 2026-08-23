import {
  contextDeltaSchema,
  conversationIdSchema,
  conversationSchema,
  messageIdSchema,
  messageSchema,
  projectIdSchema,
} from "@cce/domain";
import { z } from "zod";

export const conversationPathParamsSchema = z
  .object({
    projectId: projectIdSchema,
    conversationId: conversationIdSchema,
  })
  .strict();

export const createConversationBodySchema = z
  .object({
    title: z.string().trim().min(1).max(200),
  })
  .strict();

export const updateConversationBodySchema = z
  .object({
    title: z.string().trim().min(1).max(200).optional(),
    archive: z.literal(true).optional(),
  })
  .strict()
  .refine((body) => body.title !== undefined || body.archive === true, {
    message: "A conversation update requires a title or archive action.",
  });

export const appendMessageBodySchema = z
  .object({
    clientMessageId: z.uuid(),
    content: z.string().trim().min(1).max(1_000_000),
  })
  .strict();

export const createChatBodySchema = appendMessageBodySchema;

export const createContextDeltaBodySchema = z
  .object({
    throughMessageSequence: z.int().nonnegative().max(2_147_483_647).optional(),
  })
  .strict();

export const conversationResponseSchema = conversationSchema;
export const conversationListResponseSchema = z.array(conversationSchema);
export const messageResponseSchema = messageSchema;
export const messageListResponseSchema = z.array(messageSchema);

export const chatStreamEventSchema = z.discriminatedUnion("type", [
  z
    .object({
      type: z.literal("user_persisted"),
      message: messageSchema,
    })
    .strict(),
  z
    .object({
      type: z.literal("assistant_started"),
      messageId: messageIdSchema,
    })
    .strict(),
  z
    .object({
      type: z.literal("text_delta"),
      text: z.string().min(1),
    })
    .strict(),
  z
    .object({
      type: z.literal("completed"),
      message: messageSchema,
    })
    .strict(),
]);

export const contextDeltaResponseSchema = contextDeltaSchema;

export type ConversationPathParams = z.infer<typeof conversationPathParamsSchema>;
export type CreateConversationBody = z.infer<typeof createConversationBodySchema>;
export type UpdateConversationBody = z.infer<typeof updateConversationBodySchema>;
export type AppendMessageBody = z.infer<typeof appendMessageBodySchema>;
export type CreateChatBody = z.infer<typeof createChatBodySchema>;
export type CreateContextDeltaBody = z.infer<typeof createContextDeltaBodySchema>;
export type ChatStreamEvent = z.infer<typeof chatStreamEventSchema>;
