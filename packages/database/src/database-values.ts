import { DatabaseError } from "./database-error";

export function databaseTimestamp(value: string): string {
  const timestamp = new Date(value);
  if (Number.isNaN(timestamp.valueOf())) {
    throw new DatabaseError("CORRUPT_DATA", "PostgreSQL returned an invalid timestamp.");
  }
  return timestamp.toISOString();
}

export function nullableDatabaseTimestamp(value: string | null): string | null {
  return value === null ? null : databaseTimestamp(value);
}

export function requireRecord<Value>(
  records: ReadonlyMap<string, Value>,
  id: string,
  recordName: string,
): Value {
  const value = records.get(id);
  if (value === undefined) {
    throw new DatabaseError("CORRUPT_DATA", `${recordName} ${id} is missing.`);
  }
  return value;
}
