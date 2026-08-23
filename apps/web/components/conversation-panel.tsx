"use client";

import type { AgentRun, ContextDelta, Conversation, Message, ProjectRole } from "@cce/domain";
import { useState, type FormEvent, type ReactElement } from "react";

import { formatInstant } from "../lib/display";

export interface AgentResult {
  readonly run: AgentRun;
  readonly proposal: ContextDelta | null;
}

interface ConversationPanelProps {
  readonly conversations: readonly Conversation[];
  readonly selectedConversationId: Conversation["id"] | null;
  readonly messages: readonly Message[];
  readonly streamingText: string | null;
  readonly lastDelta: ContextDelta | null;
  readonly agentResult: AgentResult | null;
  readonly role: ProjectRole;
  readonly projectArchived: boolean;
  readonly busy: boolean;
  readonly onCreateConversation: (title: string) => Promise<void>;
  readonly onSelectConversation: (conversationId: Conversation["id"]) => void;
  readonly onUpdateConversation: (
    conversationId: Conversation["id"],
    update: { readonly title?: string; readonly archive?: true },
  ) => Promise<void>;
  readonly onChat: (content: string) => Promise<void>;
  readonly onExtract: () => Promise<void>;
  readonly onCreateMerge: (delta: ContextDelta) => Promise<void>;
  readonly onRunAgent: (objective: string) => Promise<void>;
  readonly onResumeAgent: (
    runId: AgentRun["id"],
    decision: "approve" | "reject",
    rationale: string,
  ) => Promise<void>;
}

function ConversationDetailsForm(props: {
  readonly conversation: Conversation;
  readonly busy: boolean;
  readonly canManage: boolean;
  readonly onUpdate: ConversationPanelProps["onUpdateConversation"];
}): ReactElement {
  const [title, setTitle] = useState(props.conversation.title);

  async function rename(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    await props.onUpdate(props.conversation.id, { title });
  }

  return (
    <div className="conversation-settings">
      <form className="inline-form" onSubmit={(event) => void rename(event)}>
        <label className="sr-only" htmlFor={`conversation-name-${props.conversation.id}`}>
          Conversation title
        </label>
        <input
          id={`conversation-name-${props.conversation.id}`}
          value={title}
          onChange={(event) => setTitle(event.currentTarget.value)}
          maxLength={200}
          required
          disabled={props.busy || !props.canManage}
        />
        <button
          type="submit"
          disabled={
            props.busy ||
            !props.canManage ||
            title.trim().length === 0 ||
            title.trim() === props.conversation.title
          }
        >
          Rename
        </button>
      </form>
      <button
        type="button"
        className="danger-button"
        disabled={props.busy || !props.canManage}
        onClick={() => void props.onUpdate(props.conversation.id, { archive: true })}
      >
        Archive conversation
      </button>
    </div>
  );
}

export function ConversationPanel(props: ConversationPanelProps): ReactElement {
  const [title, setTitle] = useState("");
  const [message, setMessage] = useState("");
  const [objective, setObjective] = useState("");
  const [approvalRationale, setApprovalRationale] = useState("");

  async function createConversation(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    await props.onCreateConversation(title);
    setTitle("");
  }

  async function sendMessage(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    const content = message;
    setMessage("");
    try {
      await props.onChat(content);
    } catch (error: unknown) {
      setMessage(content);
      throw error;
    }
  }

  async function runAgent(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    await props.onRunAgent(objective);
    setObjective("");
  }

  function createMergeFromLastDelta(): void {
    if (props.lastDelta !== null) {
      void props.onCreateMerge(props.lastDelta);
    }
  }

  const selected = props.conversations.find(
    (conversation) => conversation.id === props.selectedConversationId,
  );
  const throughSequence = props.messages.at(-1)?.sequence ?? 0;
  const pendingAgentRunId = props.agentResult?.run.id;
  const canPropose = props.role !== "viewer";
  const canCreateConversation = canPropose && !props.projectArchived;
  const canManageSelected =
    canPropose && !props.projectArchived && selected?.status === "active";

  return (
    <section className="conversation-layout" aria-labelledby="conversation-title">
      <aside className="conversation-list panel-stack">
        <div className="section-heading">
          <div>
            <p className="eyebrow">Evidence streams</p>
            <h2 id="conversation-title">Conversations</h2>
          </div>
          <span className="count-pill">{props.conversations.length}</span>
        </div>
        <div className="conversation-links">
          {props.conversations.map((conversation) => (
            <button
              type="button"
              key={conversation.id}
              className={
                conversation.id === props.selectedConversationId
                  ? "conversation-link selected"
                  : "conversation-link"
              }
              onClick={() => void props.onSelectConversation(conversation.id)}
            >
              <strong>{conversation.title}</strong>
              <small>{formatInstant(conversation.createdAt)}</small>
            </button>
          ))}
        </div>
        <form
          className="new-conversation-form"
          onSubmit={(event) => void createConversation(event)}
        >
          <label htmlFor="conversation-title-input">New conversation</label>
          <input
            id="conversation-title-input"
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            maxLength={200}
            placeholder="Planning, discovery, review…"
            required
          />
          <button
            type="submit"
            disabled={props.busy || !canCreateConversation || title.trim().length === 0}
          >
            Create conversation
          </button>
          {canCreateConversation ? null : (
            <small>
              {props.projectArchived ? "Archived projects are read-only." : "Viewer access is read-only."}
            </small>
          )}
        </form>
      </aside>

      <div className="chat-panel panel-stack">
        {selected === undefined ? (
          <div className="empty-state">
            <strong>Select or create a conversation</strong>
            <p>Messages remain evidence until a reviewed ContextCommit changes project state.</p>
          </div>
        ) : (
          <>
            <header className="chat-heading">
              <div>
                <p className="eyebrow">Branch conversation</p>
                <h3>{selected.title}</h3>
              </div>
              <span className={`status status-${selected.status}`}>{selected.status}</span>
            </header>
            <ConversationDetailsForm
              key={`${selected.id}:${selected.title}`}
              conversation={selected}
              busy={props.busy}
              canManage={canManageSelected}
              onUpdate={props.onUpdateConversation}
            />
            <div className="message-list" aria-live="polite">
              {props.messages.length === 0 ? (
                <div className="empty-state compact">
                  <strong>No evidence yet</strong>
                  <p>Start with an observation, constraint, or decision to discuss.</p>
                </div>
              ) : (
                props.messages.map((entry) => (
                  <article className={`message message-${entry.role}`} key={entry.id}>
                    <div>
                      <strong>{entry.role === "user" ? "You" : "CCE assistant"}</strong>
                      <small>#{entry.sequence}</small>
                    </div>
                    <p>{entry.content}</p>
                    {entry.deliveryState === "completed" ? null : (
                      <span className={`delivery delivery-${entry.deliveryState}`}>
                        {entry.deliveryState}
                      </span>
                    )}
                  </article>
                ))
              )}
              {props.streamingText === null ? null : (
                <article className="message message-assistant streaming-message">
                  <div>
                    <strong>CCE assistant</strong>
                    <small>streaming</small>
                  </div>
                  <p>{props.streamingText.length === 0 ? "Thinking…" : props.streamingText}</p>
                </article>
              )}
            </div>
            <form className="composer" onSubmit={(event) => void sendMessage(event)}>
              <label htmlFor="chat-message">Message</label>
              <textarea
                id="chat-message"
                value={message}
                onChange={(event) => setMessage(event.target.value)}
                maxLength={1_000_000}
                placeholder="Add evidence or ask about canonical project context…"
                required
                disabled={!canManageSelected}
              />
              <div className="composer-actions">
                <span>Conversation is evidence, not project state.</span>
                <button
                  className="primary-button"
                  type="submit"
                  disabled={props.busy || !canManageSelected || message.trim().length === 0}
                >
                  Send
                </button>
              </div>
            </form>

            <div className="proposal-tools">
              <div>
                <p className="eyebrow">Proposal pipeline</p>
                <strong>Turn evidence into a reviewable Delta</strong>
              </div>
              <button
                type="button"
                disabled={props.busy || !canManageSelected || throughSequence === 0}
                onClick={() => void props.onExtract()}
              >
                Extract context
              </button>
              {props.lastDelta === null ? null : (
                <button
                  className="accent-button"
                  type="button"
                  disabled={props.busy || !canManageSelected}
                  onClick={createMergeFromLastDelta}
                >
                  Review {props.lastDelta.changes.length} changes
                </button>
              )}
            </div>

            <form className="agent-console" onSubmit={(event) => void runAgent(event)}>
              <div>
                <p className="eyebrow">Scoped agent</p>
                <strong>Delegate analysis, preserve human authority</strong>
              </div>
              <label htmlFor="agent-objective">Agent objective</label>
              <textarea
                id="agent-objective"
                value={objective}
                onChange={(event) => setObjective(event.target.value)}
                maxLength={4_000}
                placeholder="Review this conversation and propose supported requirements."
                disabled={!canManageSelected}
              />
              <button
                type="submit"
                disabled={
                  props.busy ||
                  !canManageSelected ||
                  throughSequence === 0 ||
                  objective.trim().length === 0
                }
              >
                Run agent
              </button>
              {props.agentResult === null ? null : (
                <div className="agent-result" role="status">
                  <span className={`status status-${props.agentResult.run.status}`}>
                    {props.agentResult.run.status.replaceAll("_", " ")}
                  </span>
                  <p>
                    {props.agentResult.proposal === null
                      ? "No Delta proposal is available."
                      : `${props.agentResult.proposal.changes.length} changes proposed.`}
                  </p>
                  {props.agentResult.run.status === "awaiting_approval" ? (
                    <div className="agent-approval">
                      <label htmlFor="agent-rationale">Approval rationale</label>
                      <input
                        id="agent-rationale"
                        value={approvalRationale}
                        onChange={(event) => setApprovalRationale(event.target.value)}
                        maxLength={2_000}
                        placeholder="Record the human decision"
                      />
                      <button
                        type="button"
                        disabled={
                          props.busy ||
                          props.role !== "owner" ||
                          !canManageSelected ||
                          approvalRationale.trim().length === 0
                        }
                        onClick={() =>
                          pendingAgentRunId === undefined
                            ? undefined
                            : void props.onResumeAgent(
                                pendingAgentRunId,
                                "approve",
                                approvalRationale,
                              )
                        }
                      >
                        Owner approve
                      </button>
                      <button
                        type="button"
                        disabled={
                          props.busy ||
                          !canManageSelected ||
                          approvalRationale.trim().length === 0
                        }
                        onClick={() =>
                          pendingAgentRunId === undefined
                            ? undefined
                            : void props.onResumeAgent(
                                pendingAgentRunId,
                                "reject",
                                approvalRationale,
                              )
                        }
                      >
                        Reject
                      </button>
                      {props.role === "owner" ? null : (
                        <small>Only an Owner can approve this high-risk proposal.</small>
                      )}
                    </div>
                  ) : null}
                </div>
              )}
            </form>
          </>
        )}
      </div>
    </section>
  );
}
