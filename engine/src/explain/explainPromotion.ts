import type { MemoryCandidate } from "../candidates/deriveCandidate.js";
import { getLifecyclePolicy } from "../policy/lifecyclePolicy.js";
import { getSubjectPolicy } from "../policy/subjectPolicy.js";
import { getTruthClassPolicy, prefersDurableByTruthClass } from "../policy/truthClassPolicy.js";
import { deriveCandidateSubject } from "../subjects/deriveSubject.js";

export interface PromotionCheckResult {
  check: string;
  passed: boolean;
  detail: string;
}

export interface PromotionExplanation {
  candidate_id: string;
  truth_class: string;
  derived_subject: string | null;
  confidence: number;
  significance: number;
  suppression: {
    suppressed: boolean;
    reasons: string[];
    checks: PromotionCheckResult[];
  };
  promotion: {
    target: "active" | "durable" | "suppressed" | "discard";
    reasons: string[];
    checks: PromotionCheckResult[];
  };
}

export function explainPromotion(candidate: MemoryCandidate): PromotionExplanation {
  const lifecycle = getLifecyclePolicy();
  const truthClassPolicy = getTruthClassPolicy(candidate.truth_class);
  const subjectPol = getSubjectPolicy(deriveCandidateSubject(candidate));
  const derivedSubject = deriveCandidateSubject(candidate);

  const suppressionChecks: PromotionCheckResult[] = [];
  const suppressionReasons: string[] = [];

  suppressionChecks.push({
    check: "candidate already suppressed",
    passed: candidate.status === "suppressed",
    detail:
      candidate.status === "suppressed"
        ? "candidate.status is 'suppressed'"
        : `candidate.status is '${candidate.status}'`
  });
  if (candidate.status === "suppressed") {
    suppressionReasons.push("candidate already marked suppressed");
  }

  const lowSignal =
    candidate.significance < lifecycle.suppressionSignificanceThreshold &&
    candidate.confidence < lifecycle.suppressionConfidenceThreshold;

  suppressionChecks.push({
    check: "low-signal candidate",
    passed: lowSignal,
    detail: `significance=${candidate.significance} (threshold=${lifecycle.suppressionSignificanceThreshold}), confidence=${candidate.confidence} (threshold=${lifecycle.suppressionConfidenceThreshold})`
  });
  if (lowSignal) {
    suppressionReasons.push("low-significance low-confidence candidate is too weak for default promotion");
  }

  const historicalOnly = !!candidate.notes?.toLowerCase().includes("historical only");
  suppressionChecks.push({
    check: "historical-only marker",
    passed: historicalOnly,
    detail: historicalOnly
      ? "notes contain 'historical only'"
      : "no historical-only marker in notes"
  });
  if (historicalOnly) {
    suppressionReasons.push("candidate marked as historical-only");
  }

  const suppressed = suppressionReasons.length > 0;

  const promotionChecks: PromotionCheckResult[] = [];
  const promotionReasons: string[] = [];
  let promotionTarget: "active" | "durable" | "suppressed" | "discard";

  if (suppressed) {
    promotionTarget = "suppressed";
    promotionChecks.push({
      check: "suppression overrides promotion",
      passed: true,
      detail: "suppression triggered — promotion target set to suppressed"
    });
  } else {
    const lowConfidence = candidate.confidence < lifecycle.discardConfidenceThreshold;
    const lowSignificance = candidate.significance < lifecycle.discardSignificanceThreshold;
    promotionChecks.push({
      check: "discard — confidence too low",
      passed: lowConfidence,
      detail: `confidence=${candidate.confidence} (discard threshold=${lifecycle.discardConfidenceThreshold})`
    });
    promotionChecks.push({
      check: "discard — significance too low",
      passed: lowSignificance,
      detail: `significance=${candidate.significance} (discard threshold=${lifecycle.discardSignificanceThreshold})`
    });

    if (lowConfidence || lowSignificance) {
      promotionTarget = "discard";
      promotionReasons.push(lowConfidence ? "confidence too low for promotion" : "significance too low for promotion");
    } else {
      const prefersDurable = prefersDurableByTruthClass(candidate.truth_class);
      promotionChecks.push({
        check: "durable by truth-class",
        passed: prefersDurable,
        detail: prefersDurable
          ? `truth_class '${candidate.truth_class}' prefers durable by policy`
          : `truth_class '${candidate.truth_class}' does not prefer durable by default`
      });

      if (prefersDurable) {
        promotionTarget = "durable";
        promotionReasons.push(`${candidate.truth_class} candidates should normally be durable`);
      } else {
        const stableEnvironment =
          candidate.truth_class === "environment" && candidate.confidence >= 0.9;
        promotionChecks.push({
          check: "stable environment — durable",
          passed: stableEnvironment,
          detail: stableEnvironment
            ? `environment with confidence=${candidate.confidence} (>= 0.9) — stable enough for durable`
            : `either not environment type or confidence=${candidate.confidence} < 0.9`
        });

        if (stableEnvironment) {
          promotionTarget = "durable";
          promotionReasons.push("stable environment truth with high confidence");
        } else if (candidate.truth_class === "operational") {
          promotionTarget = "active";
          promotionReasons.push("operational context belongs in active memory first");
          promotionChecks.push({
            check: "operational — active by default",
            passed: true,
            detail: "operational records go to active first"
          });
        } else {
          const highSignal =
            candidate.significance >= 0.8 && candidate.confidence >= 0.8;
          promotionChecks.push({
            check: "high-signal — durable",
            passed: highSignal,
            detail: `significance=${candidate.significance}, confidence=${candidate.confidence} (both need >= 0.8 for durable)`
          });

          if (highSignal) {
            promotionTarget = "durable";
            promotionReasons.push("high-significance confirmed candidate merits durable promotion");
          } else {
            promotionTarget = "active";
            promotionReasons.push("candidate is useful but better treated as active first");
          }
        }
      }
    }
  }

  promotionChecks.push({
    check: "subject significance bonus applied",
    passed: subjectPol.significanceBonus > 0,
    detail: `derived subject '${derivedSubject ?? "(none)"}' contributes significance bonus of ${subjectPol.significanceBonus}`
  });

  return {
    candidate_id: candidate.id,
    truth_class: candidate.truth_class,
    derived_subject: derivedSubject,
    confidence: candidate.confidence,
    significance: candidate.significance,
    suppression: {
      suppressed,
      reasons: suppressionReasons,
      checks: suppressionChecks
    },
    promotion: {
      target: promotionTarget,
      reasons: promotionReasons,
      checks: promotionChecks
    }
  };
}
