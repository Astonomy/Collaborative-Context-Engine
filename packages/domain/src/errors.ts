export type DomainErrorCode =
  | "INVALID_STATE_TRANSITION"
  | "INVARIANT_VIOLATION"
  | "LAST_OWNER"
  | "PROJECT_SCOPE_MISMATCH"
  | "PROVENANCE_REQUIRED"
  | "HIGH_RISK_APPROVAL_REQUIRED"
  | "STALE_CONTEXT_HEAD";

export class DomainError extends Error {
  public readonly code: DomainErrorCode;

  public constructor(code: DomainErrorCode, message: string) {
    super(message);
    this.name = "DomainError";
    this.code = code;
  }
}

