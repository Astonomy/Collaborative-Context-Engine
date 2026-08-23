"use client";

import { useState, type FormEvent, type ReactElement } from "react";

interface LoginPanelProps {
  readonly busy: boolean;
  readonly error: string | null;
  readonly onLogin: (apiToken: string) => Promise<void>;
}

export function LoginPanel({ busy, error, onLogin }: LoginPanelProps): ReactElement {
  const [apiToken, setApiToken] = useState("");

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    await onLogin(apiToken);
  }

  return (
    <main className="login-shell">
      <section className="login-copy" aria-labelledby="welcome-title">
        <p className="eyebrow">Collaborative Context Engine</p>
        <h1 id="welcome-title">Turn conversation into reviewed project memory.</h1>
        <p>
          Keep evidence, proposals, and canonical context separate. Every accepted semantic change
          lands in an immutable commit with human accountability.
        </p>
        <div className="principle-grid" aria-label="CCE principles">
          <span>Evidence first</span>
          <span>Deterministic merge</span>
          <span>Human approval</span>
        </div>
      </section>
      <section className="login-card" aria-labelledby="sign-in-title">
        <div className="brand-mark" aria-hidden="true">
          C
        </div>
        <h2 id="sign-in-title">Open your workspace</h2>
        <p>Use a project API token. It is encrypted into a secure, HttpOnly browser session.</p>
        <form onSubmit={(event) => void submit(event)}>
          <label htmlFor="api-token">API token</label>
          <input
            id="api-token"
            name="apiToken"
            type="password"
            minLength={24}
            maxLength={512}
            autoComplete="current-password"
            required
            value={apiToken}
            onChange={(event) => setApiToken(event.currentTarget.value)}
            placeholder="Paste your CCE token"
          />
          {error === null ? null : (
            <p className="form-error" role="alert">
              {error}
            </p>
          )}
          <button className="primary-button" type="submit" disabled={busy || apiToken.length < 24}>
            {busy ? "Authenticating…" : "Continue securely"}
          </button>
        </form>
      </section>
    </main>
  );
}
