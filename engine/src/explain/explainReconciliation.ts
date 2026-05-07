import type { MemoryCandidate } from "../candidates/deriveCandidate.js";
import { getTruthClassPolicy } from "../policy/truthClassPolicy.js";
import { isExclusiveOperationalSubject } from "../policy/subjectPolicy.js";
import { deriveCandidateSubject, normalizeSubject } from "../subjects/deriveSubject.js";
import type { LoadedMemoryRecord } from "../types/MemoryItem.js";

export interface ReconciliationCheckResult {
  check: string;
  passed: boolean;
  detail: string;
}

export interface CandidateReconciliationExplanation {
  candidate_id: string;
  truth_class: string;
  derived_subject: string | null;
  policy: {
    allow_supersede: boolean;
    supersede_threshold: number;
    subject_exclusive: boolean;
    reinforce_by_subject: boolean;
    duplicate_summary_match: boolean;
    duplicate_assertion_match: boolean;
  };
  eligible_existing: number;
  checks: ReconciliationCheckResult[];
  outcome: {
    action: "create" | "reinforce" | "supersede";
    reason: string;
    existing_id: string | null;
    score: number | null;
  };
}

function normalizeText(text: string | null | undefined): string {
  return normalizeSubject(text);
}

function tokenize(text: string): string[] {
  return normalizeText(text)
    .split(" ")
    .map((t) => t.trim())
    .filter((t) => t.length > 2);
}

function jaccardSimilarity(a: string, b: string): number {
  const aTokens = new Set(tokenize(a));
  const bTokens = new Set(tokenize(b));
  if (aTokens.size === 0 || bTokens.size === 0) return 0;
  let intersection = 0;
  for (const token of aTokens) {
    if (bTokens.has(token)) intersection += 1;
  }
  return intersection / new Set([...aTokens, ...bTokens]).size;
}

function hasScopeOverlap(left: string[], right: string[]): boolean {
  return left.some((scope) => right.includes(scope));
}

export function explainReconciliation(
  candidate: MemoryCandidate,
  existingRecords: LoadedMemoryRecord[]
): CandidateReconciliationExplanation {
  const policy = getTruthClassPolicy(candidate.truth_class);
  const candidateSubject = deriveCandidateSubject(candidate);
  const checks: ReconciliationCheckResult[] = [];

  const relevantRecords = existingRecords.filter((record) => {
    if (record.item.truth_class !== candidate.truth_class) return false;
    if (record.item.status !== "confirmed") return false;
    if (!hasScopeOverlap(record.item.scope, candidate.scope)) return false;
    return true;
  });

  checks.push({
    check: "scope + truth-class filter",
    passed: relevantRecords.length > 0,
    detail: `${relevantRecords.length} of ${existingRecords.length} existing record(s) share truth_class '${candidate.truth_class}' and scope overlap`
  });

  // Duplicate check
  const duplicates = relevantRecords.filter((record) => {
    const sameSummary = normalizeText(record.item.summary) === normalizeText(candidate.summary);
    const sameAssertion = normalizeText(record.item.assertion) === normalizeText(candidate.assertion);
    const existingSubject = normalizeSubject(record.item.subject);
    const derivedSubject = normalizeSubject(candidateSubject);
    const subjectMatch = policy.reinforceBySubject && existingSubject && derivedSubject && existingSubject === derivedSubject;

    if (policy.duplicateSummaryMatch && sameSummary) return true;
    if (policy.duplicateAssertionMatch && sameAssertion) return true;
    if (subjectMatch && (sameSummary || sameAssertion)) return true;
    return false;
  });

  checks.push({
    check: "duplicate detection",
    passed: duplicates.length > 0,
    detail:
      duplicates.length > 0
        ? `found ${duplicates.length} duplicate(s): ${duplicates.map((r) => r.item.id).join(", ")}`
        : "no duplicate summary/assertion match found"
  });

  if (duplicates.length > 0) {
    const best = duplicates.sort((a, b) => {
      const stateRank = { durable: 3, active: 2, suppressed: 1 } as const;
      return (stateRank[b.item.state] ?? 0) - (stateRank[a.item.state] ?? 0);
    })[0];

    return {
      candidate_id: candidate.id,
      truth_class: candidate.truth_class,
      derived_subject: candidateSubject,
      policy: {
        allow_supersede: policy.allowSupersede,
        supersede_threshold: policy.supersedeThreshold,
        subject_exclusive: policy.subjectExclusive,
        reinforce_by_subject: policy.reinforceBySubject,
        duplicate_summary_match: policy.duplicateSummaryMatch,
        duplicate_assertion_match: policy.duplicateAssertionMatch
      },
      eligible_existing: relevantRecords.length,
      checks,
      outcome: {
        action: "reinforce",
        reason: "duplicate match found — will reinforce existing memory",
        existing_id: best.item.id,
        score: null
      }
    };
  }

  // Subject-exclusive supersede check
  if (policy.subjectExclusive) {
    const exclusiveMatches = relevantRecords.filter((record) => {
      const existingSubject = normalizeSubject(record.item.subject);
      const derivedSubject = normalizeSubject(candidateSubject);
      if (!existingSubject || !derivedSubject || existingSubject !== derivedSubject) return false;
      if (candidate.truth_class === "operational") return isExclusiveOperationalSubject(candidateSubject);
      return true;
    });

    checks.push({
      check: "subject-exclusive operational supersede",
      passed: exclusiveMatches.length > 0,
      detail:
        exclusiveMatches.length > 0
          ? `subject '${candidateSubject}' is exclusive — found ${exclusiveMatches.length} match(es): ${exclusiveMatches.map((r) => r.item.id).join(", ")}`
          : `subject '${candidateSubject ?? "(none)"}' is not exclusive or no match found`
    });

    if (exclusiveMatches.length > 0) {
      const best = exclusiveMatches.sort((a, b) => {
        const stateRank = { durable: 3, active: 2, suppressed: 1 } as const;
        return (stateRank[b.item.state] ?? 0) - (stateRank[a.item.state] ?? 0);
      })[0];

      return {
        candidate_id: candidate.id,
        truth_class: candidate.truth_class,
        derived_subject: candidateSubject,
        policy: {
          allow_supersede: policy.allowSupersede,
          supersede_threshold: policy.supersedeThreshold,
          subject_exclusive: policy.subjectExclusive,
          reinforce_by_subject: policy.reinforceBySubject,
          duplicate_summary_match: policy.duplicateSummaryMatch,
          duplicate_assertion_match: policy.duplicateAssertionMatch
        },
        eligible_existing: relevantRecords.length,
        checks,
        outcome: {
          action: "supersede",
          reason: "subject-exclusive match — will supersede existing memory",
          existing_id: best.item.id,
          score: 1
        }
      };
    }
  }

  // Similarity-based supersede check
  if (policy.allowSupersede) {
    const scores = relevantRecords
      .filter((record) => record.item.state !== "suppressed")
      .map((record) => {
        const summaryScore = jaccardSimilarity(record.item.summary, candidate.summary);
        const assertionScore = jaccardSimilarity(record.item.assertion, candidate.assertion);
        const scopeBonus = hasScopeOverlap(record.item.scope, candidate.scope) ? 0.08 : 0;
        const existingSubject = normalizeSubject(record.item.subject);
        const derivedSubject = normalizeSubject(candidateSubject);
        const subjectBonus =
          policy.reinforceBySubject && existingSubject && derivedSubject && existingSubject === derivedSubject ? 0.18 : 0;
        const score = Math.max(summaryScore, assertionScore) + scopeBonus + subjectBonus;
        return { record, summaryScore, assertionScore, scopeBonus, subjectBonus, score };
      })
      .filter(({ score }) => score > 0)
      .sort((a, b) => b.score - a.score);

    const topCandidate = scores[0];
    const meetsThreshold = topCandidate && topCandidate.score >= policy.supersedeThreshold;

    checks.push({
      check: "similarity supersede",
      passed: meetsThreshold ?? false,
      detail:
        scores.length === 0
          ? "no candidates to score"
          : meetsThreshold
          ? `top candidate '${topCandidate.record.item.id}' scored ${topCandidate.score.toFixed(3)} (summary=${topCandidate.summaryScore.toFixed(3)}, assertion=${topCandidate.assertionScore.toFixed(3)}, scope_bonus=${topCandidate.scopeBonus}, subject_bonus=${topCandidate.subjectBonus}) — threshold is ${policy.supersedeThreshold}`
          : `top candidate '${scores[0].record.item.id}' scored ${scores[0].score.toFixed(3)} — below threshold ${policy.supersedeThreshold}`
    });

    if (meetsThreshold) {
      return {
        candidate_id: candidate.id,
        truth_class: candidate.truth_class,
        derived_subject: candidateSubject,
        policy: {
          allow_supersede: policy.allowSupersede,
          supersede_threshold: policy.supersedeThreshold,
          subject_exclusive: policy.subjectExclusive,
          reinforce_by_subject: policy.reinforceBySubject,
          duplicate_summary_match: policy.duplicateSummaryMatch,
          duplicate_assertion_match: policy.duplicateAssertionMatch
        },
        eligible_existing: relevantRecords.length,
        checks,
        outcome: {
          action: "supersede",
          reason: "similarity score exceeds threshold — will supersede existing memory",
          existing_id: topCandidate.record.item.id,
          score: topCandidate.score
        }
      };
    }
  }

  checks.push({
    check: "create fallthrough",
    passed: true,
    detail: "no reinforce or supersede conditions met — will create new memory"
  });

  return {
    candidate_id: candidate.id,
    truth_class: candidate.truth_class,
    derived_subject: candidateSubject,
    policy: {
      allow_supersede: policy.allowSupersede,
      supersede_threshold: policy.supersedeThreshold,
      subject_exclusive: policy.subjectExclusive,
      reinforce_by_subject: policy.reinforceBySubject,
      duplicate_summary_match: policy.duplicateSummaryMatch,
      duplicate_assertion_match: policy.duplicateAssertionMatch
    },
    eligible_existing: relevantRecords.length,
    checks,
    outcome: {
      action: "create",
      reason: "no conflicting memory found",
      existing_id: null,
      score: null
    }
  };
}
