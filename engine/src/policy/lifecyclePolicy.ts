import type { MemoryCandidate } from "../candidates/deriveCandidate.js";
import type { MemoryState } from "../types/MemoryItem.js";

export interface LifecyclePolicy {
  discardConfidenceThreshold: number;
  discardSignificanceThreshold: number;
  suppressionConfidenceThreshold: number;
  suppressionSignificanceThreshold: number;
  activeReviewAfterSessions: number;
  activeReviewAfterInteractions: number;
}

const LIFECYCLE_POLICY: LifecyclePolicy = {
  discardConfidenceThreshold: 0.45,
  discardSignificanceThreshold: 0.4,
  suppressionConfidenceThreshold: 0.6,
  suppressionSignificanceThreshold: 0.5,
  activeReviewAfterSessions: 6,
  activeReviewAfterInteractions: 20
};

export function getLifecyclePolicy(): LifecyclePolicy {
  return LIFECYCLE_POLICY;
}

export function shouldDiscardCandidate(candidate: Pick<MemoryCandidate, "confidence" | "significance">): boolean {
  return (
    candidate.confidence < LIFECYCLE_POLICY.discardConfidenceThreshold ||
    candidate.significance < LIFECYCLE_POLICY.discardSignificanceThreshold
  );
}

export function shouldSuppressForLowSignal(candidate: Pick<MemoryCandidate, "confidence" | "significance">): boolean {
  return (
    candidate.significance < LIFECYCLE_POLICY.suppressionSignificanceThreshold &&
    candidate.confidence < LIFECYCLE_POLICY.suppressionConfidenceThreshold
  );
}

export function reviewDefaultsForState(state: MemoryState): {
  review_after_sessions: number | null;
  review_after_interactions: number | null;
  activity_state: "open" | null;
} {
  if (state === "active") {
    return {
      review_after_sessions: LIFECYCLE_POLICY.activeReviewAfterSessions,
      review_after_interactions: LIFECYCLE_POLICY.activeReviewAfterInteractions,
      activity_state: "open"
    };
  }

  return {
    review_after_sessions: null,
    review_after_interactions: null,
    activity_state: null
  };
}
