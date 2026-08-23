import { describe, expect, it } from "vitest";

import { SessionCookieCodec } from "./session-cookie";

describe("SessionCookieCodec", () => {
  const codec = new SessionCookieCodec("a production-strength session secret with 48 bytes");
  const token = "development-token-with-enough-entropy";

  it("round-trips an encrypted, unexpired API token", () => {
    const session = codec.seal(token, 1_000);
    expect(session).not.toContain(token);
    expect(codec.open(session, 1_001)).toBe(token);
  });

  it("rejects tampering and expiration", () => {
    const session = codec.seal(token, 1_000);
    expect(codec.open(`${session}tampered`, 1_001)).toBeNull();
    expect(codec.open(session, Number.MAX_SAFE_INTEGER)).toBeNull();
  });
});
