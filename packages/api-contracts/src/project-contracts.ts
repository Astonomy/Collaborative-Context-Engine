import {
  projectIdSchema,
  projectMemberSchema,
  projectRoleSchema,
  projectSchema,
  userIdSchema,
} from "@cce/domain";
import { z } from "zod";

export const projectPathParamsSchema = z.object({ projectId: projectIdSchema }).strict();

export const projectMemberPathParamsSchema = projectPathParamsSchema
  .extend({ userId: userIdSchema })
  .strict();

export const createProjectBodySchema = z
  .object({
    name: z.string().trim().min(1).max(160),
  })
  .strict();

export const updateProjectBodySchema = z
  .object({
    name: z.string().trim().min(1).max(160).optional(),
    archive: z.literal(true).optional(),
  })
  .strict()
  .refine((body) => body.name !== undefined || body.archive === true, {
    message: "A project update requires a name or archive action.",
  });

export const addProjectMemberBodySchema = z
  .object({
    email: z.email().max(320),
    role: projectRoleSchema,
  })
  .strict();

export const changeProjectMemberRoleBodySchema = z
  .object({
    role: projectRoleSchema,
  })
  .strict();

export const projectAccessResponseSchema = z
  .object({
    project: projectSchema,
    member: projectMemberSchema,
  })
  .strict();

export const projectResponseSchema = projectSchema;
export const projectListResponseSchema = z.array(projectAccessResponseSchema);

export const projectMemberResponseSchema = projectMemberSchema;
export const projectMemberListResponseSchema = z.array(projectMemberSchema);
export const projectMemberMutationResponseSchema = z.object({ success: z.literal(true) }).strict();

export type ProjectPathParams = z.infer<typeof projectPathParamsSchema>;
export type ProjectMemberPathParams = z.infer<typeof projectMemberPathParamsSchema>;
export type CreateProjectBody = z.infer<typeof createProjectBodySchema>;
export type UpdateProjectBody = z.infer<typeof updateProjectBodySchema>;
export type AddProjectMemberBody = z.infer<typeof addProjectMemberBodySchema>;
export type ChangeProjectMemberRoleBody = z.infer<typeof changeProjectMemberRoleBodySchema>;
