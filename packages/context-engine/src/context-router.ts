import type { ContextItemVersion } from "@cce/domain";

import type { ContextPack } from "./context-builder";

export type ContextRoute =
  | "chat"
  | "extraction"
  | "conflict"
  | "coding"
  | "research"
  | "review"
  | "manager";

export interface RoutedContextPack extends ContextPack {
  readonly route: ContextRoute;
}

const emptyItems: readonly ContextItemVersion[] = [];

export function routeContext(pack: ContextPack, route: ContextRoute): RoutedContextPack {
  switch (route) {
    case "coding":
      return {
        ...pack,
        route,
        facts: emptyItems,
        assumptions: emptyItems,
        openQuestions: emptyItems,
        risks: emptyItems,
        preferences: emptyItems,
        rejectedOptions: emptyItems,
      };
    case "research":
      return {
        ...pack,
        route,
        tasks: emptyItems,
        architecture: emptyItems,
      };
    case "conflict":
    case "review":
      return { ...pack, route, recentMessages: [] };
    case "extraction":
      return { ...pack, route, alternatives: emptyItems };
    case "chat":
    case "manager":
      return { ...pack, route };
  }
}

