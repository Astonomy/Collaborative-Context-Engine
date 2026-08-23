"use client";

import {
  agentRunResponseSchema,
  contextDeltaResponseSchema,
  contextSnapshotResponseSchema,
  conversationListResponseSchema,
  conversationResponseSchema,
  finalizeMergeRequestResponseSchema,
  mergeRequestDetailResponseSchema,
  mergeRequestListResponseSchema,
  messageListResponseSchema,
  projectListResponseSchema,
  projectResponseSchema,
  resolveMergeConflictResponseSchema,
  sessionResponseSchema,
} from "@cce/api-contracts";
import type { ProjectAccess } from "@cce/application";
import {
  contextCommitSchema,
  type AgentRun,
  type ContextCommit,
  type ContextDelta,
  type ContextItemVersion,
  type Conversation,
  type MergeConflict,
  type MergeRequest,
  type Message,
  type User,
} from "@cce/domain";
import { useEffect, useState, type ReactElement } from "react";
import { z } from "zod";

import { ApiClientError, requestJson, streamChat } from "../lib/api-client";
import { ConversationPanel, type AgentResult } from "./conversation-panel";
import { ContextPanel } from "./context-panel";
import { HistoryPanel } from "./history-panel";
import { LoginPanel } from "./login-panel";
import { MergePanel, type MergeDetail } from "./merge-panel";
import { ProjectSidebar } from "./project-sidebar";

const commitListSchema = z.array(contextCommitSchema);
type WorkspaceTab = "conversation" | "context" | "history" | "merge";

function messageFor(error: unknown): string {
  if (error instanceof ApiClientError || error instanceof Error) {
    return error.message;
  }
  return "The request could not be completed.";
}

function addOrReplaceMessage(messages: readonly Message[], message: Message): readonly Message[] {
  const existing = messages.findIndex((entry) => entry.id === message.id);
  if (existing === -1) {
    return [...messages, message].sort((left, right) => left.sequence - right.sequence);
  }
  return messages.map((entry) => (entry.id === message.id ? message : entry));
}

export function CceWorkbench(): ReactElement {
  const [session, setSession] = useState<User | null | undefined>(undefined);
  const [projects, setProjects] = useState<readonly ProjectAccess[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);
  const [conversations, setConversations] = useState<readonly Conversation[]>([]);
  const [selectedConversationId, setSelectedConversationId] = useState<Conversation["id"] | null>(
    null,
  );
  const [messages, setMessages] = useState<readonly Message[]>([]);
  const [items, setItems] = useState<readonly ContextItemVersion[]>([]);
  const [commits, setCommits] = useState<readonly ContextCommit[]>([]);
  const [merges, setMerges] = useState<readonly MergeRequest[]>([]);
  const [mergeDetail, setMergeDetail] = useState<MergeDetail | null>(null);
  const [lastDelta, setLastDelta] = useState<ContextDelta | null>(null);
  const [agentResult, setAgentResult] = useState<AgentResult | null>(null);
  const [streamingText, setStreamingText] = useState<string | null>(null);
  const [tab, setTab] = useState<WorkspaceTab>("conversation");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const selectedAccess = projects.find((entry) => entry.project.id === selectedProjectId) ?? null;

  useEffect(() => {
    const controller = new AbortController();
    void (async () => {
      try {
        const current = await requestJson("/api/session", sessionResponseSchema, {
          signal: controller.signal,
        });
        const available = await requestJson("/api/projects", projectListResponseSchema, {
          signal: controller.signal,
        });
        setSession(current.user);
        setProjects(available);
        setSelectedProjectId(available[0]?.project.id ?? null);
      } catch (bootstrapError: unknown) {
        if (controller.signal.aborted) {
          return;
        }
        if (bootstrapError instanceof ApiClientError && bootstrapError.status === 401) {
          setSession(null);
        } else {
          setSession(null);
          setError(messageFor(bootstrapError));
        }
      }
    })();
    return () => controller.abort();
  }, []);

  useEffect(() => {
    if (selectedProjectId === null || session === null || session === undefined) {
      return;
    }
    const controller = new AbortController();
    void Promise.all([
      requestJson(
        `/api/projects/${selectedProjectId}/conversations`,
        conversationListResponseSchema,
        { signal: controller.signal },
      ),
      requestJson(`/api/projects/${selectedProjectId}/context`, contextSnapshotResponseSchema, {
        signal: controller.signal,
      }),
      requestJson(`/api/projects/${selectedProjectId}/context/commits`, commitListSchema, {
        signal: controller.signal,
      }),
      requestJson(
        `/api/projects/${selectedProjectId}/merge-requests`,
        mergeRequestListResponseSchema,
        { signal: controller.signal },
      ),
    ])
      .then(([nextConversations, context, nextCommits, nextMerges]) => {
        if (controller.signal.aborted) {
          return;
        }
        setConversations(nextConversations);
        setSelectedConversationId(nextConversations[0]?.id ?? null);
        setItems(context.items);
        setCommits(nextCommits);
        setMerges(nextMerges);
        setMergeDetail(null);
        setLastDelta(null);
        setAgentResult(null);
        setMessages([]);
      })
      .catch((loadError: unknown) => {
        if (!controller.signal.aborted) {
          setError(messageFor(loadError));
        }
      });
    return () => controller.abort();
  }, [selectedProjectId, session]);

  useEffect(() => {
    if (selectedProjectId === null || selectedConversationId === null) {
      return;
    }
    const controller = new AbortController();
    void requestJson(
      `/api/projects/${selectedProjectId}/conversations/${selectedConversationId}/messages`,
      messageListResponseSchema,
      { signal: controller.signal },
    )
      .then((nextMessages) => {
        if (!controller.signal.aborted) {
          setMessages(nextMessages);
        }
      })
      .catch((loadError: unknown) => {
        if (!controller.signal.aborted) {
          setError(messageFor(loadError));
        }
      });
    return () => controller.abort();
  }, [selectedProjectId, selectedConversationId]);

  async function perform(action: () => Promise<void>): Promise<void> {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await action();
    } catch (actionError: unknown) {
      setError(messageFor(actionError));
    } finally {
      setBusy(false);
    }
  }

  async function reloadProjects(selectId?: string): Promise<void> {
    const available = await requestJson("/api/projects", projectListResponseSchema);
    setProjects(available);
    setSelectedProjectId(selectId ?? selectedProjectId ?? available[0]?.project.id ?? null);
  }

  async function login(apiToken: string): Promise<void> {
    await perform(async () => {
      const current = await requestJson("/api/session", sessionResponseSchema, {
        method: "POST",
        body: JSON.stringify({ apiToken }),
      });
      setSession(current.user);
      const available = await requestJson("/api/projects", projectListResponseSchema);
      setProjects(available);
      setSelectedProjectId(available[0]?.project.id ?? null);
    });
  }

  async function logout(): Promise<void> {
    await perform(async () => {
      await requestJson("/api/session", z.object({ success: z.literal(true) }).strict(), {
        method: "DELETE",
      });
      setSession(null);
      setProjects([]);
      setSelectedProjectId(null);
    });
  }

  async function createProject(name: string): Promise<void> {
    await perform(async () => {
      const project = await requestJson("/api/projects", projectResponseSchema, {
        method: "POST",
        body: JSON.stringify({ name }),
      });
      await reloadProjects(project.id);
      setNotice(`${project.name} created with an immutable genesis commit.`);
    });
  }

  async function updateProject(
    projectId: ProjectAccess["project"]["id"],
    update: { readonly name?: string; readonly archive?: true },
  ): Promise<void> {
    await perform(async () => {
      const project = await requestJson(`/api/projects/${projectId}`, projectResponseSchema, {
        method: "PATCH",
        body: JSON.stringify(update),
      });
      setProjects((current) =>
        current.map((access) =>
          access.project.id === project.id ? { ...access, project } : access,
        ),
      );
      setNotice(
        project.archivedAt === null
          ? `Project renamed to ${project.name}.`
          : `${project.name} is archived and read-only.`,
      );
    });
  }

  async function createConversation(title: string): Promise<void> {
    if (selectedProjectId === null) {
      return;
    }
    await perform(async () => {
      const conversation = await requestJson(
        `/api/projects/${selectedProjectId}/conversations`,
        conversationResponseSchema,
        { method: "POST", body: JSON.stringify({ title }) },
      );
      setConversations((current) => [conversation, ...current]);
      setSelectedConversationId(conversation.id);
      setMessages([]);
    });
  }

  async function updateConversation(
    conversationId: Conversation["id"],
    update: { readonly title?: string; readonly archive?: true },
  ): Promise<void> {
    if (selectedProjectId === null) return;
    await perform(async () => {
      const conversation = await requestJson(
        `/api/projects/${selectedProjectId}/conversations/${conversationId}`,
        conversationResponseSchema,
        { method: "PATCH", body: JSON.stringify(update) },
      );
      setConversations((current) =>
        current.map((entry) => (entry.id === conversation.id ? conversation : entry)),
      );
      if (conversation.status === "archived") {
        setLastDelta(null);
        setAgentResult(null);
      }
      setNotice(
        conversation.status === "archived"
          ? `${conversation.title} is archived and read-only.`
          : `Conversation renamed to ${conversation.title}.`,
      );
    });
  }

  function selectConversation(conversationId: Conversation["id"]): void {
    setMessages([]);
    setSelectedConversationId(conversationId);
    setLastDelta(null);
    setAgentResult(null);
  }

  function selectProject(projectId: string): void {
    setConversations([]);
    setSelectedConversationId(null);
    setMessages([]);
    setItems([]);
    setCommits([]);
    setMerges([]);
    setMergeDetail(null);
    setSelectedProjectId(projectId);
  }

  async function chat(content: string): Promise<void> {
    if (selectedProjectId === null || selectedConversationId === null) {
      return;
    }
    await perform(async () => {
      setStreamingText(null);
      await streamChat(
        `/api/projects/${selectedProjectId}/conversations/${selectedConversationId}/chat`,
        { clientMessageId: crypto.randomUUID(), content },
        (event) => {
          switch (event.type) {
            case "user_persisted":
              setMessages((current) => addOrReplaceMessage(current, event.message));
              break;
            case "assistant_started":
              setStreamingText("");
              break;
            case "text_delta":
              setStreamingText((current) => `${current ?? ""}${event.text}`);
              break;
            case "completed":
              setMessages((current) => addOrReplaceMessage(current, event.message));
              setStreamingText(null);
              break;
          }
        },
      );
    });
  }

  async function extract(): Promise<void> {
    if (selectedProjectId === null || selectedConversationId === null) {
      return;
    }
    await perform(async () => {
      const delta = await requestJson(
        `/api/projects/${selectedProjectId}/conversations/${selectedConversationId}/deltas`,
        contextDeltaResponseSchema,
        { method: "POST", body: "{}" },
      );
      setLastDelta(delta);
      setNotice(`${delta.changes.length} evidence-backed changes are ready for review.`);
    });
  }

  async function createMerge(delta: ContextDelta): Promise<void> {
    if (selectedProjectId === null) {
      return;
    }
    await perform(async () => {
      const detail = await requestJson(
        `/api/projects/${selectedProjectId}/merge-requests`,
        mergeRequestDetailResponseSchema,
        { method: "POST", body: JSON.stringify({ deltaId: delta.id }) },
      );
      setMerges((current) => [detail.request, ...current]);
      setMergeDetail(detail);
      setTab("merge");
    });
  }

  async function selectMerge(mergeRequestId: MergeRequest["id"]): Promise<void> {
    if (selectedProjectId === null) {
      return;
    }
    await perform(async () => {
      const detail = await requestJson(
        `/api/projects/${selectedProjectId}/merge-requests/${mergeRequestId}`,
        mergeRequestDetailResponseSchema,
      );
      setMergeDetail(detail);
    });
  }

  async function resolveMerge(
    conflict: MergeConflict,
    choice: "keep_current" | "accept_proposed" | "keep_alternative",
    rationale: string,
  ): Promise<void> {
    if (selectedProjectId === null || mergeDetail === null) {
      return;
    }
    await perform(async () => {
      await requestJson(
        `/api/projects/${selectedProjectId}/merge-requests/${mergeDetail.request.id}/conflicts/${conflict.id}/resolution`,
        resolveMergeConflictResponseSchema,
        {
          method: "PUT",
          body: JSON.stringify({ choice, editedProposal: null, rationale }),
        },
      );
      await selectMerge(mergeDetail.request.id);
    });
  }

  async function finalizeMerge(request: MergeRequest): Promise<void> {
    if (selectedProjectId === null || selectedAccess === null) {
      return;
    }
    await perform(async () => {
      const result = await requestJson(
        `/api/projects/${selectedProjectId}/merge-requests/${request.id}/finalize`,
        finalizeMergeRequestResponseSchema,
        {
          method: "POST",
          headers: { "idempotency-key": crypto.randomUUID() },
          body: JSON.stringify({
            expectedHeadCommitId: selectedAccess.project.headCommitId,
            summary: `Merge reviewed proposal ${request.id}`,
          }),
        },
      );
      await reloadProjects(selectedProjectId);
      const [context, nextCommits, nextMerges] = await Promise.all([
        requestJson(`/api/projects/${selectedProjectId}/context`, contextSnapshotResponseSchema),
        requestJson(`/api/projects/${selectedProjectId}/context/commits`, commitListSchema),
        requestJson(
          `/api/projects/${selectedProjectId}/merge-requests`,
          mergeRequestListResponseSchema,
        ),
      ]);
      setItems(context.items);
      setCommits(nextCommits);
      setMerges(nextMerges);
      setMergeDetail(null);
      setNotice(
        result.outcome === "committed"
          ? `ContextCommit v${result.commit.version} is now canonical HEAD.`
          : "Review completed without semantic changes.",
      );
    });
  }

  async function runAgent(objective: string): Promise<void> {
    if (selectedProjectId === null || selectedConversationId === null) {
      return;
    }
    const throughMessageSequence = messages.at(-1)?.sequence ?? 0;
    await perform(async () => {
      const result = await requestJson(
        `/api/projects/${selectedProjectId}/agents/runs`,
        agentRunResponseSchema,
        {
          method: "POST",
          body: JSON.stringify({
            conversationId: selectedConversationId,
            throughMessageSequence,
            objective,
          }),
        },
      );
      setAgentResult(result);
      if (result.run.status === "completed" && result.proposal !== null) {
        setLastDelta(result.proposal);
      }
    });
  }

  async function resumeAgent(
    runId: AgentRun["id"],
    decision: "approve" | "reject",
    rationale: string,
  ): Promise<void> {
    if (selectedProjectId === null) {
      return;
    }
    await perform(async () => {
      const result = await requestJson(
        `/api/projects/${selectedProjectId}/agents/runs/${runId}/resume`,
        agentRunResponseSchema,
        { method: "POST", body: JSON.stringify({ decision, rationale }) },
      );
      setAgentResult(result);
      if (result.run.status === "completed" && result.proposal !== null) {
        setLastDelta(result.proposal);
        setNotice("Owner-approved Agent Delta is ready for merge review.");
      }
    });
  }

  if (session === undefined) {
    return (
      <main className="loading-screen" aria-live="polite">
        <div className="brand-mark">C</div>
        <p>Opening CCE workspace…</p>
      </main>
    );
  }
  if (session === null) {
    return <LoginPanel busy={busy} error={error} onLogin={login} />;
  }

  return (
    <div className="workspace-shell">
      <header className="topbar">
        <div className="brand-lockup">
          <div className="brand-mark" aria-hidden="true">
            C
          </div>
          <div>
            <strong>Collaborative Context Engine</strong>
            <span>Project memory, reviewed</span>
          </div>
        </div>
        <div className="user-menu">
          <span>
            <strong>{session.displayName}</strong>
            <small>{session.email}</small>
          </span>
          <button type="button" onClick={() => void logout()} disabled={busy}>
            Sign out
          </button>
        </div>
      </header>
      <div className="workspace-body">
        <ProjectSidebar
          projects={projects}
          selectedProjectId={selectedProjectId}
          busy={busy}
          onSelect={selectProject}
          onCreate={createProject}
          onUpdate={updateProject}
        />
        <main className="project-workspace">
          {error === null ? null : (
            <div className="error-banner" role="alert">
              <span>{error}</span>
              <button type="button" onClick={() => setError(null)} aria-label="Dismiss error">
                ×
              </button>
            </div>
          )}
          {notice === null ? null : (
            <div className="notice-banner" role="status">
              <span>{notice}</span>
              <button type="button" onClick={() => setNotice(null)} aria-label="Dismiss notice">
                ×
              </button>
            </div>
          )}
          {selectedAccess === null ? (
            <section className="project-empty">
              <p className="eyebrow">Ready when you are</p>
              <h1>Create a project to establish canonical context.</h1>
              <p>Each project begins with a genesis commit and you as its Owner.</p>
            </section>
          ) : (
            <>
              <header className="project-header">
                <div>
                  <p className="eyebrow">Project · {selectedAccess.member.role}</p>
                  <h1>{selectedAccess.project.name}</h1>
                  <span>
                    Canonical version {selectedAccess.project.version} · {items.length} active items
                  </span>
                </div>
                <div className="head-chip">
                  <span>Context HEAD</span>
                  <code>{selectedAccess.project.headCommitId.slice(0, 12)}</code>
                </div>
              </header>
              <nav className="workspace-tabs" aria-label="Project views">
                {(
                  [
                    ["conversation", "Conversations"],
                    ["context", "Canonical context"],
                    ["history", "History"],
                    ["merge", "Merge review"],
                  ] as const
                ).map(([value, label]) => (
                  <button
                    type="button"
                    key={value}
                    className={tab === value ? "selected" : ""}
                    aria-current={tab === value ? "page" : undefined}
                    onClick={() => setTab(value)}
                  >
                    {label}
                  </button>
                ))}
              </nav>
              <div className="workspace-content">
                {tab === "conversation" ? (
                  <ConversationPanel
                    conversations={conversations}
                    selectedConversationId={selectedConversationId}
                    messages={messages}
                    streamingText={streamingText}
                    lastDelta={lastDelta}
                    agentResult={agentResult}
                    role={selectedAccess.member.role}
                    projectArchived={selectedAccess.project.archivedAt !== null}
                    busy={busy}
                    onCreateConversation={createConversation}
                    onSelectConversation={selectConversation}
                    onUpdateConversation={updateConversation}
                    onChat={chat}
                    onExtract={extract}
                    onCreateMerge={createMerge}
                    onRunAgent={runAgent}
                    onResumeAgent={resumeAgent}
                  />
                ) : null}
                {tab === "context" ? (
                  <ContextPanel items={items} headCommitId={selectedAccess.project.headCommitId} />
                ) : null}
                {tab === "history" ? <HistoryPanel commits={commits} /> : null}
                {tab === "merge" ? (
                  <MergePanel
                    requests={merges}
                    detail={mergeDetail}
                    role={selectedAccess.member.role}
                    headCommitId={selectedAccess.project.headCommitId}
                    busy={busy}
                    onSelect={selectMerge}
                    onResolve={resolveMerge}
                    onFinalize={finalizeMerge}
                  />
                ) : null}
              </div>
            </>
          )}
        </main>
      </div>
    </div>
  );
}
