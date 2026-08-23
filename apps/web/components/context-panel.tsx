import type { ContextItemVersion } from "@cce/domain";
import type { ReactElement } from "react";

import { compactId, displayValue, formatInstant } from "../lib/display";

interface ContextPanelProps {
  readonly items: readonly ContextItemVersion[];
  readonly headCommitId: string;
}

export function ContextPanel({ items, headCommitId }: ContextPanelProps): ReactElement {
  return (
    <section className="panel-stack" aria-labelledby="context-title">
      <div className="section-heading">
        <div>
          <p className="eyebrow">Source of truth</p>
          <h2 id="context-title">Canonical context</h2>
        </div>
        <code title={headCommitId}>HEAD {compactId(headCommitId)}</code>
      </div>
      {items.length === 0 ? (
        <div className="empty-state">
          <strong>No canonical items yet</strong>
          <p>Chat in a conversation, extract a Delta, then review and commit it.</p>
        </div>
      ) : (
        <div className="context-grid">
          {items.map((item) => (
            <article className="context-card" key={item.id}>
              <div className="context-card-heading">
                <span className={`kind-badge kind-${item.kind}`}>{item.kind}</span>
                <span className={`lifecycle lifecycle-${item.lifecycle}`}>{item.lifecycle}</span>
              </div>
              <h3>{item.key}</h3>
              <pre>{displayValue(item.value)}</pre>
              <dl className="context-meta">
                <div>
                  <dt>Authority</dt>
                  <dd>{item.authority}</dd>
                </div>
                <div>
                  <dt>Confidence</dt>
                  <dd>{Math.round(item.confidence * 100)}%</dd>
                </div>
                <div>
                  <dt>Evidence</dt>
                  <dd>
                    {item.provenance.reduce((sum, entry) => sum + entry.messageIds.length, 0)} msgs
                  </dd>
                </div>
                <div>
                  <dt>Recorded</dt>
                  <dd>{formatInstant(item.createdAt)}</dd>
                </div>
              </dl>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}
