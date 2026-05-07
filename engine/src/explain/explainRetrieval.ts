import { getRetrievalPolicy } from "../policy/retrievalPolicy.js";
import { subjectPriority } from "../policy/subjectPolicy.js";
import { calculateScopeScore } from "../scopes/matchScopes.js";
import { matchesRetrievalQuery } from "../retrieval/buildRetrievalSet.js";

function canonicalizeToken(token: string): string {
  const normalized = token.trim().toLowerCase();
  if (!normalized) return normalized;
  if (["focus", "focused", "focusing", "focussed", "focuesed"].includes(normalized)) return "focus";
  if (["working", "worked", "work"].includes(normalized)) return "work";
  return normalized;
}

function tokenize(text: string): string[] {
  return normalizeText(text)
    .split(" ")
    .map((token) => canonicalizeToken(token))
    .filter(Boolean);
}

function subjectSemanticMatches(record: MemoryItem, query: string): boolean {
  const subject = normalizeText(record.subject);
  if (!subject) return false;
  const queryTokens = tokenize(query);
  if (subject === "current-focus") {
    return queryTokens.includes("focus") || queryTokens.includes("work");
  }
  return false;
}
import type { BuildRetrievalSetOptions } from "../retrieval/buildRetrievalSet.js";
import type { MemoryItem } from "../types/MemoryItem.js";

export interface RecordRetrievalExplanation {
  id: string;
  included: boolean;
  bucket: "active" | "durable" | "policy" | "excluded";
  exclusion_reason: string | null;
  scores: {
    scope: number;
    subject_priority: number;
    query: number;
    importance: number;
    retrieval_weight: number;
    confidence: number;
  };
  query_match_field: string | null;
}

export interface RetrievalExplanation {
  query: string;
  requested_scopes: string[];
  records: RecordRetrievalExplanation[];
  limits: {
    limit: number;
    active_limit: number;
    durable_limit: number;
    policy_limit: number;
  };
}

function normalizeText(value: string | null | undefined): string {
  return (value ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function resolveQueryMatchField(record: MemoryItem, query: string): string | null {
  const normalizedQuery = normalizeText(query);
  if (!normalizedQuery) return null;

  const policy = getRetrievalPolicy();
  const subject = normalizeText(record.subject);
  const summary = normalizeText(record.summary);
  const assertion = normalizeText(record.assertion);
  const tags = (record.tags ?? []).map((tag) => normalizeText(tag)).filter(Boolean);

  if (subject === normalizedQuery) return `subject (exact match, score=${policy.exactSubjectQueryScore})`;
  if (subjectSemanticMatches(record, normalizedQuery)) return `subject semantic match (score=${policy.exactSubjectQueryScore})`;
  if (summary.includes(normalizedQuery)) return `summary (score=${policy.summaryQueryScore})`;
  if (assertion.includes(normalizedQuery)) return `assertion (score=${policy.assertionQueryScore})`;
  if (tags.some((tag) => tag === normalizedQuery || tag.includes(normalizedQuery))) return `tags (score=${policy.tagQueryScore})`;
  if (matchesRetrievalQuery(record, query)) return `partial token match (score=${policy.partialQueryScore})`;
  return null;
}

function resolveExclusionReason(
  record: MemoryItem,
  query: string,
  includeSuppressed: boolean
): string | null {
  if (["invalid", "inactive", "superseded"].includes(record.status)) {
    return `status is '${record.status}'`;
  }

  if (!includeSuppressed && record.state === "suppressed") {
    return "state is suppressed and suppressed records are not included";
  }

  if (query && !matchesRetrievalQuery(record, query)) {
    return `does not match query '${query}'`;
  }

  return null;
}

function determineBucket(
  record: MemoryItem,
  included: boolean
): "active" | "durable" | "policy" | "excluded" {
  if (!included) return "excluded";
  if (record.truth_class === "policy") return "policy";
  if (record.state === "active") return "active";
  return "durable";
}

export function explainRetrieval(
  records: MemoryItem[],
  options: BuildRetrievalSetOptions = {}
): RetrievalExplanation {
  const {
    limit = 8,
    activeLimit = 4,
    durableLimit = 4,
    policyLimit = 3,
    requestedScopes = [],
    query = "",
    includeSuppressed = false
  } = options;

  const explanations: RecordRetrievalExplanation[] = records.map((record) => {
    const exclusionReason = resolveExclusionReason(record, query, includeSuppressed);
    const included = exclusionReason === null;
    const bucket = determineBucket(record, included);

    return {
      id: record.id,
      included,
      bucket,
      exclusion_reason: exclusionReason,
      scores: {
        scope: calculateScopeScore(record.scope, requestedScopes),
        subject_priority: subjectPriority(record.subject),
        query: included ? (query ? (matchesRetrievalQuery(record, query) ? 1 : 0) : 0) : 0,
        importance: record.importance,
        retrieval_weight: record.retrieval_weight,
        confidence: record.confidence
      },
      query_match_field: included && query ? resolveQueryMatchField(record, query) : null
    };
  });

  return {
    query,
    requested_scopes: requestedScopes,
    records: explanations,
    limits: {
      limit,
      active_limit: activeLimit,
      durable_limit: durableLimit,
      policy_limit: policyLimit
    }
  };
}
