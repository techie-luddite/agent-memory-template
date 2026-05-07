import type { MemoryCandidate } from "../candidates/deriveCandidate.js";
import { shouldDiscardCandidate } from "../policy/lifecyclePolicy.js";
import { assessCurrentFocus } from "../policy/currentFocusPolicy.js";
import { assessMemorySignal } from "../policy/signalPolicy.js";
import { prefersDurableByTruthClass } from "../policy/truthClassPolicy.js";
import { deriveCandidateSubject } from "../subjects/deriveSubject.js";

export interface PromotionDecision {
  target: "active" | "durable" | "suppressed" | "discard";
  reasons: string[];
}

export function evaluatePromotion(candidate: MemoryCandidate): PromotionDecision {
  const reasons: string[] = [];

  if (deriveCandidateSubject(candidate) === "current-focus") {
    const focus = assessCurrentFocus(candidate);
    if (!focus.valid) {
      return {
        target: "suppressed",
        reasons: focus.reasons
      };
    }
  }

  const signal = assessMemorySignal(candidate);
  if (signal.noisy) {
    return {
      target: "suppressed",
      reasons: signal.reasons
    };
  }

  if (shouldDiscardCandidate(candidate)) {
    if (candidate.confidence < 0.45) {
      return {
        target: "discard",
        reasons: ["confidence too low for promotion"]
      };
    }

    return {
      target: "discard",
      reasons: ["significance too low for promotion"]
    };
  }

  if (prefersDurableByTruthClass(candidate.truth_class)) {
    reasons.push(`${candidate.truth_class} candidates should normally be durable`);
    return { target: "durable", reasons };
  }

  if (candidate.truth_class === "environment" && candidate.confidence >= 0.9) {
    reasons.push("stable environment truth with high confidence");
    return { target: "durable", reasons };
  }

  if (candidate.truth_class === "operational") {
    reasons.push("operational context belongs in active memory first");
    return { target: "active", reasons };
  }

  if (candidate.significance >= 0.8 && candidate.confidence >= 0.8) {
    reasons.push("high-significance confirmed candidate merits durable promotion");
    return { target: "durable", reasons };
  }

  reasons.push("candidate is useful but better treated as active first");
  return {
    target: "active",
    reasons
  };
}
