export interface IdGenerator {
  next(): string;
}

export interface Clock {
  now(): Date;
}

export interface ContentHasher {
  sha256(value: string): string;
}

export const isoDateTimeSchemaOptions = { offset: true } as const;
