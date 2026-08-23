import { expect, test, type Route } from "@playwright/test";

const now = "2026-08-23T10:00:00.000Z";
const ids = {
  user: "00000000-0000-4000-8000-000000000001",
  project: "00000000-0000-4000-8000-000000000002",
  genesis: "00000000-0000-4000-8000-000000000003",
  semantic: "00000000-0000-4000-8000-000000000004",
  conversation: "00000000-0000-4000-8000-000000000005",
  branch: "00000000-0000-4000-8000-000000000006",
  userMessage: "00000000-0000-4000-8000-000000000007",
  assistantMessage: "00000000-0000-4000-8000-000000000008",
  modelRun: "00000000-0000-4000-8000-000000000009",
  delta: "00000000-0000-4000-8000-000000000010",
  deltaChange: "00000000-0000-4000-8000-000000000011",
  merge: "00000000-0000-4000-8000-000000000012",
  conflict: "00000000-0000-4000-8000-000000000013",
  logicalItem: "00000000-0000-4000-8000-000000000014",
  item: "00000000-0000-4000-8000-000000000015",
  commitChange: "00000000-0000-4000-8000-000000000016",
};

const user = { id: ids.user, email: "alice@example.test", displayName: "Alice", createdAt: now };
const project = {
  id: ids.project,
  name: "Apollo",
  headCommitId: ids.genesis,
  version: 0,
  createdBy: ids.user,
  createdAt: now,
  archivedAt: null,
};
const member = { projectId: ids.project, userId: ids.user, role: "owner", joinedAt: now };
const conversation = {
  id: ids.conversation,
  projectId: ids.project,
  branchId: ids.branch,
  title: "Architecture review",
  status: "active",
  createdBy: { type: "human", userId: ids.user },
  createdAt: now,
  archivedAt: null,
};
const provenance = {
  projectId: ids.project,
  conversationId: ids.conversation,
  messageIds: [ids.userMessage],
  actor: { type: "human", userId: ids.user },
  modelRunId: null,
  recordedAt: now,
};
const proposal = {
  kind: "requirement",
  key: "security.audit_retention",
  value: { days: 365 },
  scope: { component: "audit", tags: ["security"] },
  authority: "authoritative",
  confidence: 0.94,
  provenance: [provenance],
  explicitSupersedesVersionId: null,
};
const delta = {
  id: ids.delta,
  projectId: ids.project,
  branchId: ids.branch,
  conversationId: ids.conversation,
  baseCommitId: ids.genesis,
  throughMessageSequence: 2,
  schemaVersion: 1,
  extractorRunId: ids.modelRun,
  revisionOf: null,
  contentHash: "a".repeat(64),
  proposedBy: { type: "model", provider: "qwen-vllm", model: "qwen", runId: ids.modelRun },
  createdAt: now,
  changes: [{ id: ids.deltaChange, operation: "add", proposal }],
};
const baseMergeRequest = {
  id: ids.merge,
  projectId: ids.project,
  branchId: ids.branch,
  deltaId: ids.delta,
  baseCommitId: ids.genesis,
  evaluatedHeadCommitId: ids.genesis,
  resultingCommitId: null,
  status: "reviewing",
  createdBy: { type: "human", userId: ids.user },
  createdAt: now,
  updatedAt: now,
};
const baseConflict = {
  id: ids.conflict,
  projectId: ids.project,
  mergeRequestId: ids.merge,
  deltaChangeId: ids.deltaChange,
  classification: "C2",
  baseVersion: null,
  currentVersion: null,
  proposed: proposal,
  reason: "No deterministic current match exists.",
  requiresHumanReview: true,
  resolution: null,
  createdAt: now,
};
const item = {
  id: ids.item,
  logicalItemId: ids.logicalItem,
  projectId: ids.project,
  commitId: ids.semantic,
  previousVersionId: null,
  kind: proposal.kind,
  key: proposal.key,
  value: proposal.value,
  scope: proposal.scope,
  authority: proposal.authority,
  confidence: proposal.confidence,
  provenance: proposal.provenance,
  lifecycle: "active",
  scopeHash: "b".repeat(64),
  supersedesVersionId: null,
  createdAt: now,
};
const genesisCommit = {
  id: ids.genesis,
  projectId: ids.project,
  kind: "genesis",
  parentCommitId: null,
  version: 0,
  idempotencyKey: `project-genesis:${ids.project}`,
  summary: "Project genesis",
  sourceDeltaIds: [],
  proposedBy: [],
  committedBy: { type: "human", userId: ids.user },
  changes: [],
  createdAt: now,
};
const semanticCommit = {
  id: ids.semantic,
  projectId: ids.project,
  kind: "semantic",
  parentCommitId: ids.genesis,
  version: 1,
  idempotencyKey: "e2e-finalize",
  summary: `Merge reviewed proposal ${ids.merge}`,
  sourceDeltaIds: [ids.delta],
  proposedBy: [delta.proposedBy],
  committedBy: { type: "human", userId: ids.user },
  changes: [
    {
      id: ids.commitChange,
      ordinal: 0,
      operation: "add",
      logicalItemId: ids.logicalItem,
      beforeVersion: null,
      afterVersion: item,
      sourceDeltaId: ids.delta,
      sourceDeltaChangeId: ids.deltaChange,
    },
  ],
  createdAt: now,
};

function fulfillJson(route: Route, body: unknown, status = 200): Promise<void> {
  return route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
}

test("conversation evidence becomes an Owner-reviewed canonical commit", async ({ page }) => {
  let conversationCreated = false;
  let mergeCreated = false;
  let mergeReady = false;
  let committed = false;

  await page.route("**/api/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname;
    const method = request.method();

    if (path === "/api/session" && method === "GET") {
      return fulfillJson(route, { user });
    }
    if (path === "/api/projects" && method === "GET") {
      const currentProject = committed
        ? { ...project, headCommitId: ids.semantic, version: 1 }
        : project;
      return fulfillJson(route, [{ project: currentProject, member }]);
    }
    if (path.endsWith("/conversations") && method === "GET") {
      return fulfillJson(route, conversationCreated ? [conversation] : []);
    }
    if (path.endsWith("/conversations") && method === "POST") {
      conversationCreated = true;
      return fulfillJson(route, conversation, 201);
    }
    if (path.endsWith("/messages") && method === "GET") {
      return fulfillJson(route, []);
    }
    if (path.endsWith("/chat") && method === "POST") {
      const userMessage = {
        id: ids.userMessage,
        projectId: ids.project,
        conversationId: ids.conversation,
        sequence: 1,
        clientMessageId: "00000000-0000-4000-8000-000000000099",
        role: "user",
        deliveryState: "completed",
        content: "Audit logs must be retained for 365 days.",
        author: { type: "human", userId: ids.user },
        providerMessageId: null,
        errorCode: null,
        createdAt: now,
        completedAt: now,
      };
      const assistantMessage = {
        id: ids.assistantMessage,
        projectId: ids.project,
        conversationId: ids.conversation,
        sequence: 2,
        clientMessageId: null,
        role: "assistant",
        deliveryState: "completed",
        content: "I will treat that statement as evidence for a reviewable requirement.",
        author: {
          type: "model",
          provider: "qwen-vllm",
          model: "qwen",
          runId: ids.modelRun,
        },
        providerMessageId: "response-1",
        errorCode: null,
        createdAt: now,
        completedAt: now,
      };
      const events = [
        { type: "user_persisted", message: userMessage },
        { type: "assistant_started", messageId: ids.assistantMessage },
        { type: "text_delta", text: assistantMessage.content },
        { type: "completed", message: assistantMessage },
      ];
      return route.fulfill({
        status: 200,
        contentType: "text/event-stream",
        body: events
          .map((event) => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`)
          .join(""),
      });
    }
    if ((path.endsWith("/deltas") || path.endsWith("/extract")) && method === "POST") {
      return fulfillJson(route, delta, 201);
    }
    if (path.endsWith("/context") && method === "GET") {
      return fulfillJson(route, {
        commitId: committed ? ids.semantic : ids.genesis,
        items: committed ? [item] : [],
      });
    }
    if (path.endsWith("/context/commits") && method === "GET") {
      return fulfillJson(route, committed ? [semanticCommit, genesisCommit] : [genesisCommit]);
    }
    if (path.endsWith("/merge-requests") && method === "GET") {
      if (!mergeCreated) {
        return fulfillJson(route, []);
      }
      const current = committed
        ? { ...baseMergeRequest, status: "committed", resultingCommitId: ids.semantic }
        : mergeReady
          ? { ...baseMergeRequest, status: "ready" }
          : baseMergeRequest;
      return fulfillJson(route, [current]);
    }
    if (path.endsWith("/merge-requests") && method === "POST") {
      mergeCreated = true;
      return fulfillJson(route, { request: baseMergeRequest, conflicts: [baseConflict] }, 201);
    }
    if (path.endsWith(`/merge-requests/${ids.merge}`) && method === "GET") {
      const resolution = mergeReady
        ? {
            choice: "accept_proposed",
            editedProposal: null,
            rationale: "The evidence is explicit and testable.",
            resolvedBy: ids.user,
            resolvedAt: now,
          }
        : null;
      return fulfillJson(route, {
        request: mergeReady ? { ...baseMergeRequest, status: "ready" } : baseMergeRequest,
        conflicts: [{ ...baseConflict, resolution }],
      });
    }
    if (path.endsWith("/resolution") && method === "PUT") {
      mergeReady = true;
      return fulfillJson(route, { ...baseMergeRequest, status: "ready" });
    }
    if (path.endsWith("/finalize") && method === "POST") {
      committed = true;
      return fulfillJson(route, { outcome: "committed", commit: semanticCommit });
    }
    return fulfillJson(
      route,
      {
        error: {
          code: "NOT_FOUND",
          message: `No E2E fixture for ${method} ${path}`,
          details: {},
        },
      },
      404,
    );
  });

  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Apollo" })).toBeVisible();

  await page.getByLabel("New conversation").fill("Architecture review");
  await page.getByRole("button", { name: "Create conversation" }).click();
  await expect(page.getByRole("heading", { name: "Architecture review" })).toBeVisible();

  await page.getByLabel("Message").fill("Audit logs must be retained for 365 days.");
  await page.getByRole("button", { name: "Send" }).click();
  await expect(
    page.getByText("I will treat that statement as evidence for a reviewable requirement."),
  ).toBeVisible();

  await page.getByRole("button", { name: "Extract context" }).click();
  await page.getByRole("button", { name: "Review 1 changes" }).click();
  await expect(page.getByText("Owner approval required")).toBeVisible();

  await page.getByLabel("Review rationale").fill("The evidence is explicit and testable.");
  await page.getByRole("button", { name: "Accept proposed" }).click();
  await expect(page.getByRole("button", { name: "Commit reviewed changes" })).toBeEnabled();
  await page.getByRole("button", { name: "Commit reviewed changes" }).click();

  await page.getByRole("button", { name: "Canonical context" }).click();
  await expect(page.getByText("security.audit_retention")).toBeVisible();
  await expect(page.getByText("ContextCommit v1 is now canonical HEAD.")).toBeVisible();
});

test("Viewer controls remain read-only", async ({ page }) => {
  await page.route("**/api/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/api/session") {
      return fulfillJson(route, { user });
    }
    if (path === "/api/projects") {
      return fulfillJson(route, [{ project, member: { ...member, role: "viewer" } }]);
    }
    if (path.endsWith("/conversations")) {
      return fulfillJson(route, [conversation]);
    }
    if (path.endsWith("/messages") || path.endsWith("/merge-requests")) {
      return fulfillJson(route, []);
    }
    if (path.endsWith("/context/commits")) {
      return fulfillJson(route, [genesisCommit]);
    }
    if (path.endsWith("/context")) {
      return fulfillJson(route, { commitId: ids.genesis, items: [] });
    }
    return fulfillJson(
      route,
      {
        error: { code: "NOT_FOUND", message: "Fixture not found.", details: {} },
      },
      404,
    );
  });

  await page.goto("/");
  await expect(page.getByText("Viewer access is read-only.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Create conversation" })).toBeDisabled();
  await expect(page.getByLabel("Message")).toBeDisabled();
  await expect(page.getByRole("button", { name: "Extract context" })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Run agent" })).toBeDisabled();
});
