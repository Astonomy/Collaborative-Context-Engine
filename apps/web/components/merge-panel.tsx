"use client";

import {
  isHighRiskContextKind,
  type MergeConflict,
  type MergeRequest,
  type ProjectRole,
} from "@cce/domain";
import { useState, type ReactElement } from "react";

import { compactId, displayValue, formatInstant } from "../lib/display";

export interface MergeDetail {
  readonly request: MergeRequest;
  readonly conflicts: readonly MergeConflict[];
}

interface MergePanelProps {
  readonly requests: readonly MergeRequest[];
  readonly detail: MergeDetail | null;
  readonly role: ProjectRole;
  readonly headCommitId: string;
  readonly busy: boolean;
  readonly onSelect: (mergeRequestId: MergeRequest["id"]) => Promise<void>;
  readonly onResolve: (
    conflict: MergeConflict,
    choice: "keep_current" | "accept_proposed" | "keep_alternative",
    rationale: string,
  ) => Promise<void>;
  readonly onFinalize: (request: MergeRequest) => Promise<void>;
}

export function MergePanel({
  requests,
  detail,
  role,
  headCommitId,
  busy,
  onSelect,
  onResolve,
  onFinalize,
}: MergePanelProps): ReactElement {
  return (
    <section className="merge-layout" aria-labelledby="merge-title">
      <div className="merge-list panel-stack">
        <div className="section-heading">
          <div>
            <p className="eyebrow">Human review gate</p>
            <h2 id="merge-title">Merge requests</h2>
          </div>
          <span className="count-pill">{requests.length}</span>
        </div>
        {requests.length === 0 ? (
          <div className="empty-state compact">
            <strong>No merge requests</strong>
            <p>Extract a Delta from a conversation to begin review.</p>
          </div>
        ) : (
          requests.map((request) => (
            <button
              className={detail?.request.id === request.id ? "merge-link selected" : "merge-link"}
              type="button"
              key={request.id}
              onClick={() => void onSelect(request.id)}
            >
              <span>
                <strong>{compactId(request.id)}</strong>
                <small>{formatInstant(request.updatedAt)}</small>
              </span>
              <span className={`status status-${request.status}`}>{request.status}</span>
            </button>
          ))
        )}
      </div>
      <div className="merge-review panel-stack">
        {detail === null ? (
          <div className="empty-state">
            <strong>Select a merge request</strong>
            <p>Every change is explicitly reviewed before it can move canonical HEAD.</p>
          </div>
        ) : (
          <>
            <div className="review-summary">
              <div>
                <p className="eyebrow">Review {compactId(detail.request.id)}</p>
                <h3>{detail.conflicts.length} proposed changes</h3>
              </div>
              <span className={`status status-${detail.request.status}`}>
                {detail.request.status}
              </span>
            </div>
            {detail.request.evaluatedHeadCommitId !== headCommitId ? (
              <div className="warning-banner" role="alert">
                Canonical HEAD moved after evaluation. Recompute this merge before finalizing.
              </div>
            ) : null}
            <div className="conflict-list">
              {detail.conflicts.map((conflict) => (
                <ConflictReview
                  key={conflict.id}
                  conflict={conflict}
                  role={role}
                  busy={busy}
                  onResolve={onResolve}
                />
              ))}
            </div>
            {detail.request.status === "ready" ? (
              <button
                className="primary-button finalize-button"
                type="button"
                disabled={
                  busy || role === "viewer" || detail.request.evaluatedHeadCommitId !== headCommitId
                }
                onClick={() => void onFinalize(detail.request)}
              >
                Commit reviewed changes
              </button>
            ) : null}
          </>
        )}
      </div>
    </section>
  );
}

interface ConflictReviewProps {
  readonly conflict: MergeConflict;
  readonly role: ProjectRole;
  readonly busy: boolean;
  readonly onResolve: MergePanelProps["onResolve"];
}

function ConflictReview({ conflict, role, busy, onResolve }: ConflictReviewProps): ReactElement {
  const [rationale, setRationale] = useState("");
  const kind = conflict.proposed?.kind ?? conflict.currentVersion?.kind;
  const highRisk = kind !== undefined && isHighRiskContextKind(kind);
  const ownerRequired = highRisk && role !== "owner";
  const reviewDenied = role === "viewer";

  return (
    <article className="conflict-card">
      <div className="conflict-heading">
        <span className={`classification class-${conflict.classification}`}>
          {conflict.classification}
        </span>
        <div>
          <strong>{conflict.proposed?.key ?? conflict.currentVersion?.key ?? "Deprecation"}</strong>
          <p>{conflict.reason}</p>
        </div>
      </div>
      {highRisk ? (
        <div className="owner-gate">
          <strong>Owner approval required</strong>
          <span>{kind} changes can only be accepted by a project Owner.</span>
        </div>
      ) : null}
      {reviewDenied ? (
        <div className="owner-gate">
          <strong>Read-only review</strong>
          <span>
            Viewer access can inspect evidence and resolutions but cannot resolve changes.
          </span>
        </div>
      ) : null}
      <div className="comparison-grid">
        <div>
          <span>Current</span>
          <pre>{displayValue(conflict.currentVersion?.value ?? "No current value")}</pre>
        </div>
        <div>
          <span>Proposed</span>
          <pre>{displayValue(conflict.proposed?.value ?? "Deprecate current value")}</pre>
        </div>
      </div>
      {conflict.resolution === null ? (
        <div className="resolution-form">
          <label htmlFor={`rationale-${conflict.id}`}>Review rationale</label>
          <textarea
            id={`rationale-${conflict.id}`}
            value={rationale}
            onChange={(event) => setRationale(event.currentTarget.value)}
            maxLength={2_000}
            placeholder="Record why this resolution is correct"
          />
          <div className="resolution-actions">
            <button
              type="button"
              disabled={busy || reviewDenied || rationale.trim().length === 0}
              onClick={() => void onResolve(conflict, "keep_current", rationale)}
            >
              Keep current
            </button>
            {conflict.proposed === null ? null : (
              <>
                <button
                  type="button"
                  disabled={busy || reviewDenied || ownerRequired || rationale.trim().length === 0}
                  onClick={() => void onResolve(conflict, "accept_proposed", rationale)}
                >
                  Accept proposed
                </button>
                <button
                  type="button"
                  disabled={busy || reviewDenied || ownerRequired || rationale.trim().length === 0}
                  onClick={() => void onResolve(conflict, "keep_alternative", rationale)}
                >
                  Keep alternative
                </button>
              </>
            )}
          </div>
        </div>
      ) : (
        <div className="resolution-recorded">
          Resolved as <strong>{conflict.resolution.choice.replaceAll("_", " ")}</strong> —{" "}
          {conflict.resolution.rationale}
        </div>
      )}
    </article>
  );
}
