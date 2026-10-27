import { afterEach, expect, it, vi } from "vitest";
import { createApp, h, nextTick, shallowRef, type Component } from "vue";
import { createMemoryHistory } from "vue-router";
import {
  messageListResponseSchema,
  mergeRequestDetailResponseSchema,
  projectAccessResponseSchema,
  sessionResponseSchema,
} from "@cce/api-contracts";
import { appContextKey } from "./context";
import { attachmentFixture } from "./attachments/fixtures";
import { projectContextKey } from "./project-context";
import { createSession } from "./data/session";
import { appRouter } from "./router";
import ConflictReview from "./components/ConflictReview.vue";
import MessageList from "./components/MessageList.vue";
import MergeReview from "./components/MergeReview.vue";
import ConversationView from "./views/ConversationView.vue";
import {
  ids,
  now,
  user,
  project,
  member,
  conversation,
  baseMergeRequest,
  baseConflict,
  delta,
} from "./migration-fixtures";

const cleanups: (() => void)[] = [];
it("renders structured attachments without inferring attachment text", async () => {
  const evidence = messages(2);
  const first = evidence[0];
  const second = evidence[1];
  if (!first || !second) throw new Error("Missing fixture");
  first.attachments = [
    attachmentFixture({
      projectId: first.projectId,
      conversationId: first.conversationId,
      messageId: first.id,
    }),
  ];
  first.content = "File shared";
  second.content = "Attachment: invented.png";
  const transport = vi
    .fn<typeof fetch>()
    .mockImplementation((input) =>
      Promise.resolve(
        Response.json(
          (typeof input === "string"
            ? input
            : input instanceof URL
              ? input.pathname
              : input.url
          ).endsWith("/messages")
            ? evidence
            : (typeof input === "string"
                  ? input
                  : input instanceof URL
                    ? input.pathname
                    : input.url
                ).endsWith("/inspection")
              ? {}
              : conversation,
        ),
      ),
    );
  const session = createSession(transport);
  session.ready.value = true;
  session.user.value = sessionResponseSchema.parse({ user }).user;
  const router = appRouter(session, "/vue/", vi.fn(), createMemoryHistory());
  await router.push({
    name: "conversation",
    params: { projectId: ids.project, conversationId: ids.conversation },
  });
  const { root, app } = mount(ConversationView);
  app.provide(appContextKey, { session, fatal: shallowRef<string | null>(null) });
  app.provide(projectContextKey, {
    access: shallowRef(projectAccessResponseSchema.parse({ project, member })),
    reload: vi.fn(),
  });
  app.use(router);
  app.mount(root);
  await new Promise((resolve) => setTimeout(resolve, 20));
  await nextTick();
  expect(root.querySelectorAll(".attachment-card")).toHaveLength(1);
  expect(root.textContent).toContain("sample.png");
  expect(root.querySelector('[aria-label="Attachment invented.png"]')).toBeNull();
});
afterEach(() => {
  cleanups.splice(0).forEach((cleanup) => cleanup());
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
});
function mount(component: Component, props: Record<string, unknown> = {}) {
  const root = document.createElement("div");
  document.body.append(root);
  const app = createApp({ render: () => h(component, props) });
  cleanups.push(() => app.unmount());
  return { root, app };
}
function button(root: Element, name: string): HTMLButtonElement {
  const result = [...root.querySelectorAll("button")].find(
    (entry) => entry.textContent?.trim() === name,
  );
  if (!result) throw new Error("Missing button " + name);
  return result;
}
async function fill(root: Element, selector: string, value: string): Promise<void> {
  const input = root.querySelector(selector);
  if (!(input instanceof HTMLInputElement || input instanceof HTMLTextAreaElement))
    throw new Error("Missing input");
  input.value = value;
  input.dispatchEvent(new Event("input", { bubbles: true }));
  await nextTick();
}
const conflict = mergeRequestDetailResponseSchema.shape.conflicts.element.parse(baseConflict);
for (const role of ["owner", "editor", "viewer"]) {
  it("enforces high-risk review affordances for " + role, async () => {
    const resolve = vi.fn();
    const { root, app } = mount(ConflictReview, {
      conflict,
      role,
      disabled: false,
      onResolve: resolve,
    });
    app.mount(root);
    await fill(root, "textarea", "Explicit evidence");
    expect(button(root, "Accept proposed").disabled).toBe(role !== "owner");
    expect(button(root, "Keep alternative").disabled).toBe(role !== "owner");
    expect(button(root, "Keep current").disabled).toBe(role === "viewer");
    button(root, "Accept proposed").click();
    expect(resolve).toHaveBeenCalledTimes(role === "owner" ? 1 : 0);
  });
}
function messages(count: number) {
  return messageListResponseSchema.parse(
    Array.from({ length: count }, (_, index) => ({
      id: "00000000-0000-4000-8000-" + String(index + 100).padStart(12, "0"),
      projectId: ids.project,
      conversationId: ids.conversation,
      sequence: index + 1,
      clientMessageId: null,
      role: "assistant",
      deliveryState: "completed",
      content: "Evidence " + (index + 1),
      author: { type: "human", userId: ids.user },
      providerMessageId: null,
      errorCode: null,
      createdAt: now,
      completedAt: now,
    })),
  );
}
it("bounds large evidence DOM, preserves sequence and exposes earlier pages without requests", async () => {
  const fetch = vi.fn();
  vi.stubGlobal("fetch", fetch);
  const { root, app } = mount(MessageList, {
    messages: messages(10001).reverse(),
    streaming: null,
  });
  app.mount(root);
  expect(root.querySelectorAll("article")).toHaveLength(1);
  expect(root.textContent).toContain("Evidence 10001");
  button(root, "Earlier messages").click();
  await nextTick();
  expect(root.querySelectorAll("article")).toHaveLength(100);
  expect(root.querySelector("article")?.textContent).toContain("Evidence 9901");
  expect(fetch).not.toHaveBeenCalled();
});

async function mountReview(role = "owner", archived = false, stale = false) {
  const transport = vi.fn<typeof fetch>(async (_input, init) => {
    if (init?.method === "POST")
      return Response.json({ error: { code: "CONFLICT", message: "HEAD moved" } }, { status: 409 });
    return Response.json({ request: { ...baseMergeRequest, status: "ready" }, conflicts: [] });
  });
  const { root, app } = mount(MergeReview, { projectId: ids.project, mergeId: ids.merge });
  const access = shallowRef(
    projectAccessResponseSchema.parse({
      project: {
        ...project,
        archivedAt: archived ? now : null,
        headCommitId: stale ? ids.semantic : ids.genesis,
      },
      member: { ...member, role },
    }),
  );
  app.provide(appContextKey, { session: createSession(transport), fatal: shallowRef(null) });
  app.provide(projectContextKey, { access, reload: vi.fn() });
  app.mount(root);
  await vi.waitFor(() => expect(root.textContent).toContain("Commit reviewed changes"));
  return { root, transport };
}
it.each([
  ["viewer", false, false],
  ["owner", true, false],
  ["owner", false, true],
] as const)("blocks commit for role=%s archived=%s stale=%s", async (role, archived, stale) => {
  const { root, transport } = await mountReview(role, archived, stale);
  expect(button(root, "Commit reviewed changes").disabled).toBe(true);
  button(root, "Commit reviewed changes").click();
  expect(transport).toHaveBeenCalledTimes(1);
});
it("surfaces concurrent HEAD failure without auto retry, retaining expected HEAD and idempotency key", async () => {
  const { root, transport } = await mountReview();
  button(root, "Commit reviewed changes").click();
  await vi.waitFor(() => expect(root.textContent).toContain("Conflict: HEAD moved"));
  expect(transport).toHaveBeenCalledTimes(2);
  const first = transport.mock.calls[1]?.[1];
  expect(JSON.parse(typeof first?.body === "string" ? first.body : "")).toMatchObject({
    expectedHeadCommitId: ids.genesis,
  });
  button(root, "Commit reviewed changes").click();
  await vi.waitFor(() => expect(transport).toHaveBeenCalledTimes(3));
  expect(new Headers(first?.headers).get("idempotency-key")).toBe(
    new Headers(transport.mock.calls[2]?.[1]?.headers).get("idempotency-key"),
  );
});
for (const [role, archived] of [
  ["viewer", false],
  ["owner", true],
  ["editor", false],
] as const) {
  it("conversation controls respect " + role + " archive=" + archived, async () => {
    const transport = vi.fn<typeof fetch>(async (input) =>
      (typeof input === "string"
        ? input
        : input instanceof URL
          ? input.pathname
          : input.url
      ).endsWith("/attachments")
        ? Response.json([])
        : Response.json(
            (typeof input === "string"
              ? input
              : input instanceof URL
                ? input.pathname
                : input.url
            ).endsWith("/messages")
              ? messages(2)
              : {
                  ...conversation,
                  status: archived ? "archived" : "active",
                  archivedAt: archived ? now : null,
                },
          ),
    );
    const session = createSession(transport);
    session.user.value = sessionResponseSchema.parse({ user }).user;
    session.ready.value = true;
    const router = appRouter(session, "/", vi.fn(), createMemoryHistory());
    await router.push("/projects/" + ids.project + "/conversations/" + ids.conversation);
    const { root, app } = mount(ConversationView);
    app.use(router);
    app.provide(appContextKey, { session, fatal: shallowRef(null) });
    app.provide(projectContextKey, {
      access: shallowRef(
        projectAccessResponseSchema.parse({ project, member: { ...member, role } }),
      ),
      reload: vi.fn(),
    });
    app.mount(root);
    await vi.waitFor(() => expect(root.textContent).toContain("Evidence 2"));
    await fill(root, "#chat-message", "Evidence");
    expect(button(root, "Send").disabled).toBe(role === "viewer" || archived);
    expect(button(root, "Extract context").disabled).toBe(role === "viewer" || archived);
    expect(transport).toHaveBeenCalledTimes(2);
  });
}

for (const role of ["owner", "editor"]) {
  it("runs an agent and preserves human approval for " + role, async () => {
    const run = {
      id: ids.modelRun,
      projectId: ids.project,
      agentName: "manager",
      status: "awaiting_approval",
      version: 1,
      state: {},
      createdAt: now,
      updatedAt: now,
    };
    const transport = vi.fn<typeof fetch>(async (input, init) => {
      const path =
        typeof input === "string" ? input : input instanceof URL ? input.pathname : input.url;
      if (path.endsWith("/resume")) {
        expect(JSON.parse(typeof init?.body === "string" ? init.body : "")).toEqual({
          decision: role === "owner" ? "approve" : "reject",
          rationale: "Evidence reviewed",
        });
        return Response.json({
          run: { ...run, status: role === "owner" ? "completed" : "cancelled" },
          proposal: role === "owner" ? delta : null,
        });
      }
      if (path.endsWith("/agents/runs")) {
        expect(JSON.parse(typeof init?.body === "string" ? init.body : "")).toMatchObject({
          conversationId: ids.conversation,
          throughMessageSequence: 2,
        });
        return Response.json({ run, proposal: null });
      }
      return Response.json(
        path.endsWith("/attachments")
          ? []
          : path.endsWith("/messages")
            ? messages(2)
            : conversation,
      );
    });
    const session = createSession(transport);
    session.user.value = sessionResponseSchema.parse({ user }).user;
    session.ready.value = true;
    const router = appRouter(session, "/", vi.fn(), createMemoryHistory());
    await router.push("/projects/" + ids.project + "/conversations/" + ids.conversation);
    const { root, app } = mount(ConversationView);
    app.use(router);
    app.provide(appContextKey, { session, fatal: shallowRef(null) });
    app.provide(projectContextKey, {
      access: shallowRef(
        projectAccessResponseSchema.parse({ project, member: { ...member, role } }),
      ),
      reload: vi.fn(),
    });
    app.mount(root);
    await vi.waitFor(() => expect(root.textContent).toContain("Evidence 2"));
    await fill(root, "#agent-objective", "Review the evidence");
    root
      .querySelector("#agent-objective")
      ?.closest("form")
      ?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    await vi.waitFor(() => expect(root.textContent).toContain("awaiting approval"));
    await fill(root, "#approval-rationale", "Evidence reviewed");
    expect(button(root, "Owner approve").disabled).toBe(role !== "owner");
    button(root, role === "owner" ? "Owner approve" : "Reject").click();
    await vi.waitFor(() =>
      expect(root.textContent).toContain(role === "owner" ? "1 proposed changes" : "cancelled"),
    );
  });
}
