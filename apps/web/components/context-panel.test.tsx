// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";

import { contextItemVersionSchema } from "@cce/domain";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { ContextPanel } from "./context-panel";

const item = contextItemVersionSchema.parse({
  id: "00000000-0000-4000-8000-000000000101",
  logicalItemId: "00000000-0000-4000-8000-000000000102",
  projectId: "00000000-0000-4000-8000-000000000001",
  commitId: "00000000-0000-4000-8000-000000000103",
  previousVersionId: null,
  kind: "requirement",
  key: "security.audit_retention",
  value: { days: 365 },
  scope: { component: "audit", tags: ["security"] },
  authority: "authoritative",
  confidence: 0.93,
  provenance: [
    {
      projectId: "00000000-0000-4000-8000-000000000001",
      conversationId: "00000000-0000-4000-8000-000000000104",
      messageIds: ["00000000-0000-4000-8000-000000000105"],
      actor: { type: "human", userId: "00000000-0000-4000-8000-000000000002" },
      modelRunId: null,
      recordedAt: "2026-08-23T10:00:00.000Z",
    },
  ],
  lifecycle: "active",
  scopeHash: "a".repeat(64),
  supersedesVersionId: null,
  createdAt: "2026-08-23T10:00:00.000Z",
});

describe("ContextPanel", () => {
  it("renders canonical values and evidence counts", () => {
    render(<ContextPanel items={[item]} headCommitId={item.commitId} />);
    expect(screen.getByRole("heading", { name: "Canonical context" })).toBeVisible();
    expect(screen.getByText("security.audit_retention")).toBeVisible();
    expect(screen.getByText("1 msgs")).toBeVisible();
    expect(screen.getByText("93%")).toBeVisible();
  });

  it("provides a meaningful empty state", () => {
    render(<ContextPanel items={[]} headCommitId={item.commitId} />);
    expect(screen.getByText("No canonical items yet")).toBeVisible();
  });
});
