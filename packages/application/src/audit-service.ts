import type { AgentRun, AuditEvent, ModelRun, ProjectId, UserId } from "@cce/domain";

import { authorizeProjectMember } from "./authorization";
import type { UnitOfWork } from "./repositories";

export interface ProjectAuditHistory {
  readonly modelRuns: readonly ModelRun[];
  readonly agentRuns: readonly AgentRun[];
  readonly events: readonly AuditEvent[];
}

export class AuditService {
  public constructor(private readonly unitOfWork: UnitOfWork) {}

  public async getProjectHistory(input: {
    readonly projectId: ProjectId;
    readonly actorUserId: UserId;
  }): Promise<ProjectAuditHistory> {
    return this.unitOfWork.run(async (repositories) => {
      const access = await repositories.projects.findAccess(
        input.projectId,
        input.actorUserId,
      );
      authorizeProjectMember(access?.member ?? null, input.actorUserId, "project:read");
      const [modelRuns, agentRuns, events] = await Promise.all([
        repositories.runs.listModelRuns(input.projectId),
        repositories.runs.listAgentRuns(input.projectId),
        repositories.audit.list(input.projectId),
      ]);
      return { modelRuns, agentRuns, events };
    });
  }
}
