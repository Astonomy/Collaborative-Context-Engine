export type ApplicationErrorCode =
  | "UNAUTHENTICATED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "CONFLICT"
  | "VALIDATION"
  | "DEPENDENCY_UNAVAILABLE";

export class ApplicationError extends Error {
  public readonly code: ApplicationErrorCode;
  public readonly details: Readonly<Record<string, string>>;

  public constructor(
    code: ApplicationErrorCode,
    message: string,
    details: Readonly<Record<string, string>> = {},
  ) {
    super(message);
    this.name = "ApplicationError";
    this.code = code;
    this.details = details;
  }
}

