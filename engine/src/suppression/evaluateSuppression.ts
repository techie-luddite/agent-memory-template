import type { MemoryCandidate } from "../candidates/deriveCandidate.js";
import { shouldSuppressForLowSignal } from "../policy/lifecyclePolicy.js";

export interface SuppressionDecision {
  suppress: boolean;
  reasons: string[];
}

export function evaluateSuppression(candidate: MemoryCandidate): SuppressionDecision {
  const reasons: string[] = [];

  if (candidate.status === "suppressed") {
    reasons.push("candidate already marked suppressed");
  }

  if (shouldSuppressForLowSignal(candidate)) {
    reasons.push("low-significance low-confidence candidate is too weak for default promotion");
  }

  if (candidate.notes?.toLowerCase().includes("historical only")) {
    reasons.push("candidate marked as historical-only");
  }

  return {
    suppress: reasons.length > 0,
    reasons
  };
}
