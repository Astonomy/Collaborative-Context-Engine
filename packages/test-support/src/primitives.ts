import { createHash } from "node:crypto";

import type { Clock, ContentHasher, IdGenerator } from "@cce/shared";

export class SequenceIdGenerator implements IdGenerator {
  private index = 0;

  public constructor(private readonly values: readonly string[]) {}

  public next(): string {
    const value = this.values[this.index];
    if (value === undefined) {
      throw new Error("SequenceIdGenerator exhausted its deterministic IDs.");
    }
    this.index += 1;
    return value;
  }
}

export class FixedClock implements Clock {
  public constructor(private current: Date) {}

  public now(): Date {
    return new Date(this.current);
  }

  public set(value: Date): void {
    this.current = new Date(value);
  }
}

export class Sha256ContentHasher implements ContentHasher {
  public sha256(value: string): string {
    return createHash("sha256").update(value).digest("hex");
  }
}

