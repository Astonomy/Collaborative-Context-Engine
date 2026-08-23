import type { ContextItemKind, ContextItemVersion, Message, Project } from "@cce/domain";

import { stableStringify } from "./canonical-json";
import { scopeIdentity } from "./scope";

export interface ContextPackProject {
  readonly id: Project["id"];
  readonly name: string;
  readonly headCommitId: Project["headCommitId"];
  readonly version: number;
}

export interface ContextPack {
  readonly schemaVersion: 1;
  readonly project: ContextPackProject;
  readonly decisions: readonly ContextItemVersion[];
  readonly requirements: readonly ContextItemVersion[];
  readonly constraints: readonly ContextItemVersion[];
  readonly facts: readonly ContextItemVersion[];
  readonly assumptions: readonly ContextItemVersion[];
  readonly tasks: readonly ContextItemVersion[];
  readonly openQuestions: readonly ContextItemVersion[];
  readonly risks: readonly ContextItemVersion[];
  readonly artifacts: readonly ContextItemVersion[];
  readonly preferences: readonly ContextItemVersion[];
  readonly rejectedOptions: readonly ContextItemVersion[];
  readonly architecture: readonly ContextItemVersion[];
  readonly alternatives: readonly ContextItemVersion[];
  readonly recentMessages: readonly Message[];
}

export interface BuildContextInput {
  readonly project: ContextPackProject;
  readonly items: readonly ContextItemVersion[];
  readonly messages: readonly Message[];
  readonly maxRecentMessages: number;
  readonly recentMessageCharacterBudget: number;
}

const maximumActiveContextItems = 2_000;
const maximumSerializedContextCharacters = 2_000_000;

function compareItems(left: ContextItemVersion, right: ContextItemVersion): number {
  return (
    left.kind.localeCompare(right.kind) ||
    left.key.localeCompare(right.key) ||
    scopeIdentity(left.scope).localeCompare(scopeIdentity(right.scope)) ||
    stableStringify(left.value).localeCompare(stableStringify(right.value)) ||
    left.id.localeCompare(right.id)
  );
}

function selectRecentMessages(
  messages: readonly Message[],
  maximum: number,
  characterBudget: number,
): readonly Message[] {
  if (!Number.isInteger(maximum) || maximum < 0) {
    throw new RangeError("maxRecentMessages must be a non-negative integer.");
  }
  if (!Number.isInteger(characterBudget) || characterBudget < 0) {
    throw new RangeError("recentMessageCharacterBudget must be a non-negative integer.");
  }
  const candidates = [...messages]
    .filter((message) => message.deliveryState === "completed")
    .sort((left, right) => right.sequence - left.sequence);
  const selected: Message[] = [];
  let consumedCharacters = 0;

  for (const message of candidates) {
    if (selected.length >= maximum) {
      break;
    }
    const remainingCharacters = characterBudget - consumedCharacters;
    if (remainingCharacters <= 0) {
      break;
    }
    if (message.content.length > remainingCharacters) {
      if (selected.length === 0) {
        selected.push({ ...message, content: message.content.slice(0, remainingCharacters) });
      }
      break;
    }
    selected.push(message);
    consumedCharacters += message.content.length;
  }
  return selected.sort((left, right) => left.sequence - right.sequence);
}

function selectKind(
  items: readonly ContextItemVersion[],
  kind: ContextItemKind,
): readonly ContextItemVersion[] {
  return items.filter((item) => item.kind === kind).sort(compareItems);
}

export function buildContextPack(input: BuildContextInput): ContextPack {
  const activeItems = input.items.filter((item) => item.lifecycle === "active");
  if (activeItems.length > maximumActiveContextItems) {
    throw new RangeError("Active Project Context exceeds the item budget.");
  }
  let serializedContextCharacters = 0;
  for (const item of activeItems) {
    serializedContextCharacters += JSON.stringify(item).length;
    if (serializedContextCharacters > maximumSerializedContextCharacters) {
      throw new RangeError("Active Project Context exceeds the serialized prompt budget.");
    }
  }
  const authoritative = activeItems.filter((item) => item.authority === "authoritative");
  const alternatives = activeItems.filter((item) => item.authority === "alternative").sort(compareItems);

  return {
    schemaVersion: 1,
    project: input.project,
    decisions: selectKind(authoritative, "decision"),
    requirements: selectKind(authoritative, "requirement"),
    constraints: selectKind(authoritative, "constraint"),
    facts: selectKind(authoritative, "fact"),
    assumptions: selectKind(authoritative, "assumption"),
    tasks: selectKind(authoritative, "task"),
    openQuestions: selectKind(authoritative, "question"),
    risks: selectKind(authoritative, "risk"),
    artifacts: selectKind(authoritative, "artifact"),
    preferences: selectKind(authoritative, "preference"),
    rejectedOptions: selectKind(authoritative, "rejected_option"),
    architecture: selectKind(authoritative, "architecture"),
    alternatives,
    recentMessages: selectRecentMessages(
      input.messages,
      input.maxRecentMessages,
      input.recentMessageCharacterBudget,
    ),
  };
}
