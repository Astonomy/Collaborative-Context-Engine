export type DatabaseErrorCode = "CORRUPT_DATA" | "NOT_FOUND" | "WRITE_CONFLICT";

export class DatabaseError extends Error {
  public readonly code: DatabaseErrorCode;

  public constructor(code: DatabaseErrorCode, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "DatabaseError";
    this.code = code;
  }
}
