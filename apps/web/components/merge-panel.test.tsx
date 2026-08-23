// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";

import { mergeConflictSchema, mergeRequestSchema } from "@cce/domain";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { MergePanel } from "./merge-panel";

afterEach(cleanup);

const ids = {
  project: "00000000-0000-4000-8000-000000000001",
  user: "00000000-0000-4000-8000-000000000002",
  request: "00000000-0000-4000-8000-000000000201",
  conflict: "00000000-0000-4000-8000-000000000202",
  change: "00000000-0000-4000-8000-000000000203",
  branch: "00000000-0000-4000-8000-000000000204",
  delta: "00000000-0000-4000-8000-000000000205",
  commit: "00000000-0000-4000-8000-000000000206",
  conversation: "00000000-0000-4000-8000-000000000207",
  message: "00000000-0000-4000-8000-000000000208",
};

const request = mergeRequestSchema.parse({
  id: ids.request,
  projectId: ids.project,
  branchId: ids.branch,
  deltaId: ids.delta,
  baseCommitId: ids.commit,
  evaluatedHeadCommitId: ids.commit,
  resultingCommitId: null,
  status: "reviewing",
  createdBy: { type: "human", userId: ids.user },
  createdAt: "2026-08-23T10:00:00.000Z",
  updatedAt: "2026-08-23T10:00:00.000Z",
});

const conflict = mergeConflictSchema.parse({
  id: ids.conflict,
  projectId: ids.project,
  mergeRequestId: ids.request,
  deltaChangeId: ids.change,
  classification: "C2",
  baseVersion: null,
  currentVersion: null,
  proposed: {
    kind: "requirement",
    key: "security.encryption",
    value: "AES-256-GCM",
    scope: { tags: ["security"] },
    authority: "authoritative",
    confidence: 0.95,
    provenance: [
      {
        projectId: ids.project,
        conversationId: ids.conversation,
        messageIds: [ids.message],
        actor: { type: "human", userId: ids.user },
        modelRunId: null,
        recordedAt: "2026-08-23T10:00:00.000Z",
      },
    ],
    explicitSupersedesVersionId: null,
  },
  reason: "The proposed requirement has no deterministic current match.",
  requiresHumanReview: true,
  resolution: null,
  createdAt: "2026-08-23T10:00:00.000Z",
});

describe("MergePanel", () => {
  it("prevents an Editor from accepting a high-risk proposal", async () => {
    const user = userEvent.setup();
    const onResolve = vi.fn().mockResolvedValue(undefined);
    render(
      <MergePanel
        requests={[request]}
        detail={{ request, conflicts: [conflict] }}
        role="editor"
        headCommitId={ids.commit}
        busy={false}
        onSelect={() => Promise.resolve()}
        onResolve={onResolve}
        onFinalize={() => Promise.resolve()}
      />,
    );
    expect(screen.getByText("Owner approval required")).toBeVisible();
    await user.type(screen.getByLabelText("Review rationale"), "Keep the current policy.");
    expect(screen.getByRole("button", { name: "Accept proposed" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Keep current" })).toBeEnabled();
  });

  it("allows an Owner to accept a reviewed high-risk proposal", async () => {
    const user = userEvent.setup();
    const onResolve = vi.fn().mockResolvedValue(undefined);
    render(
      <MergePanel
        requests={[request]}
        detail={{ request, conflicts: [conflict] }}
        role="owner"
        headCommitId={ids.commit}
        busy={false}
        onSelect={() => Promise.resolve()}
        onResolve={onResolve}
        onFinalize={() => Promise.resolve()}
      />,
    );
    await user.type(
      screen.getByLabelText("Review rationale"),
      "Evidence supports this requirement.",
    );
    await user.click(screen.getByRole("button", { name: "Accept proposed" }));
    expect(onResolve).toHaveBeenCalledWith(
      conflict,
      "accept_proposed",
      "Evidence supports this requirement.",
    );
  });

  it("keeps all resolution actions read-only for a Viewer", async () => {
    const user = userEvent.setup();
    render(
      <MergePanel
        requests={[request]}
        detail={{ request, conflicts: [conflict] }}
        role="viewer"
        headCommitId={ids.commit}
        busy={false}
        onSelect={() => Promise.resolve()}
        onResolve={() => Promise.resolve()}
        onFinalize={() => Promise.resolve()}
      />,
    );
    expect(screen.getByText("Read-only review")).toBeVisible();
    await user.type(screen.getByLabelText("Review rationale"), "I can inspect but not resolve.");
    expect(screen.getByRole("button", { name: "Keep current" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Accept proposed" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Keep alternative" })).toBeDisabled();
  });
});
