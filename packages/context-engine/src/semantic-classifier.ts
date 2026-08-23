import type { JsonValue } from "@cce/shared";

import type { MergeConflictPlan, MergePlan } from "./merge-types";

export type SemanticClassification = "C1" | "C2" | "C3" | "C4";

export interface SemanticClassificationInput {
  readonly key: string;
  readonly baseValue: JsonValue | null;
  readonly currentValue: JsonValue | null;
  readonly proposedValue: JsonValue | null;
  readonly reason: string;
}

export interface SemanticClassificationProposal {
  readonly classification: SemanticClassification;
  readonly confidence: number;
  readonly rationale: string;
}

export interface SemanticConflictClassifier {
  classify(input: SemanticClassificationInput): Promise<SemanticClassificationProposal>;
}

export interface SemanticConflictReview {
  readonly conflict: MergeConflictPlan;
  readonly proposal: SemanticClassificationProposal;
  readonly acceptedForDisplay: boolean;
  readonly error: string | null;
}

function isValidProposal(value: SemanticClassificationProposal): boolean {
  return (
    ["C1", "C2", "C3", "C4"].includes(value.classification) &&
    Number.isFinite(value.confidence) &&
    value.confidence >= 0 &&
    value.confidence <= 1 &&
    value.rationale.trim().length > 0
  );
}

export async function classifyPotentialConflicts(
  plan: MergePlan,
  classifier: SemanticConflictClassifier,
  minimumDisplayConfidence = 0.8,
): Promise<readonly SemanticConflictReview[]> {
  const reviews: SemanticConflictReview[] = [];
  for (const conflict of plan.conflicts) {
    if (conflict.classification !== "C2") {
      continue;
    }
    try {
      const proposal = await classifier.classify({
        key:
          conflict.proposed?.key ??
          conflict.currentVersion?.key ??
          conflict.baseVersion?.key ??
          "unknown",
        baseValue: conflict.baseVersion?.value ?? null,
        currentValue: conflict.currentVersion?.value ?? null,
        proposedValue: conflict.proposed?.value ?? null,
        reason: conflict.reason,
      });
      if (!isValidProposal(proposal)) {
        throw new Error("Classifier returned an invalid semantic classification proposal.");
      }
      reviews.push({
        conflict,
        proposal,
        acceptedForDisplay: proposal.confidence >= minimumDisplayConfidence,
        error: null,
      });
    } catch (error: unknown) {
      reviews.push({
        conflict,
        proposal: {
          classification: "C2",
          confidence: 0,
          rationale: "Semantic classification was unavailable; human review remains required.",
        },
        acceptedForDisplay: false,
        error: error instanceof Error ? error.message : "Unknown semantic classifier failure.",
      });
    }
  }
  return reviews;
}

