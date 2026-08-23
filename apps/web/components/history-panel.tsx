import type { ContextCommit } from "@cce/domain";
import type { ReactElement } from "react";

import { compactId, formatInstant } from "../lib/display";

interface HistoryPanelProps {
  readonly commits: readonly ContextCommit[];
}

export function HistoryPanel({ commits }: HistoryPanelProps): ReactElement {
  return (
    <section className="panel-stack" aria-labelledby="history-title">
      <div className="section-heading">
        <div>
          <p className="eyebrow">Immutable ledger</p>
          <h2 id="history-title">Commit history</h2>
        </div>
        <span className="count-pill">{commits.length} commits</span>
      </div>
      <ol className="commit-list">
        {commits.map((commit, index) => (
          <li key={commit.id}>
            <div className="timeline-node" aria-hidden="true">
              {index === 0 ? "H" : "·"}
            </div>
            <article>
              <div className="commit-title">
                <strong>{commit.summary}</strong>
                <code title={commit.id}>{compactId(commit.id)}</code>
              </div>
              <p>
                Version {commit.version} · {commit.kind} · {commit.changes.length} semantic changes
              </p>
              <small>{formatInstant(commit.createdAt)}</small>
            </article>
          </li>
        ))}
      </ol>
    </section>
  );
}
