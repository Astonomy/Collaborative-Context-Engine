import { getTableColumns } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import {
  agentRuns,
  auditEvents,
  branches,
  contextCommitChanges,
  contextCommitSources,
  contextCommits,
  contextDeltaChanges,
  contextDeltas,
  contextItemProvenance,
  contextItemProvenanceMessages,
  contextItemVersions,
  conversations,
  currentContextItems,
  mergeConflicts,
  mergeRequests,
  messages,
  modelRuns,
  projectMembers,
  projects,
} from "./schema";

describe("project-scoped PostgreSQL schema", () => {
  it("carries project_id on every project-scoped table", () => {
    const projectScopedTables = [
      projects,
      projectMembers,
      contextCommits,
      conversations,
      branches,
      messages,
      modelRuns,
      agentRuns,
      contextDeltas,
      contextDeltaChanges,
      contextItemVersions,
      contextItemProvenance,
      contextItemProvenanceMessages,
      contextCommitSources,
      contextCommitChanges,
      currentContextItems,
      mergeRequests,
      mergeConflicts,
      auditEvents,
    ];

    for (const table of projectScopedTables) {
      expect(getTableColumns(table)).toHaveProperty("projectId");
    }
  });
});
