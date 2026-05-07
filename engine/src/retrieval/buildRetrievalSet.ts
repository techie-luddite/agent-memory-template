import { assessCurrentFocus } from "../policy/currentFocusPolicy.js";
import { getRetrievalPolicy } from "../policy/retrievalPolicy.js";
import { assessMemorySignal } from "../policy/signalPolicy.js";
import { subjectPriority } from "../policy/subjectPolicy.js";
import { calculateScopeScore } from "../scopes/matchScopes.js";
import type { MemoryItem } from "../types/MemoryItem.js";

export interface RetrievalSet {
  active: MemoryItem[];
  durable: MemoryItem[];
  policies: MemoryItem[];
  suppressedConsidered: boolean;
  notes: string | null;
}

export interface BuildRetrievalSetOptions {
  limit?: number;
  activeLimit?: number;
  durableLimit?: number;
  policyLimit?: number;
  requestedScopes?: string[];
  query?: string;
  includeSuppressed?: boolean;
}

function normalizeText(value: string | null | undefined): string {
  return (value ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const STOPWORDS = new Set([
  "a", "an", "the", "and", "or", "to", "of", "in", "on", "for", "with",
  "what", "which", "who", "how", "are", "is", "was", "were", "am", "be",
  "we", "i", "you", "do", "did", "does", "our", "my", "your", "current"
]);

function canonicalizeToken(token: string): string {
  const normalized = token.trim().toLowerCase();
  if (!normalized) return normalized;
  if (["focus", "focused", "focusing", "focussed", "focuesed"].includes(normalized)) return "focus";
  if (["working", "worked", "work"].includes(normalized)) return "work";
  return normalized;
}

function tokenize(text: string, options: { dropStopwords?: boolean } = {}): string[] {
  const tokens = normalizeText(text)
    .split(" ")
    .map((token) => canonicalizeToken(token))
    .filter(Boolean);

  if (!options.dropStopwords) return tokens;
  return tokens.filter((token) => !STOPWORDS.has(token));
}

function subjectSemanticMatches(record: MemoryItem, query: string): boolean {
  const subject = normalizeText(record.subject);
  if (!subject) return false;

  const queryTokens = tokenize(query, { dropStopwords: true });
  if (queryTokens.length === 0) return false;

  if (subject === "current-focus") {
    return queryTokens.includes("focus") || queryTokens.includes("work");
  }

  return false;
}

function buildSearchFields(record: MemoryItem) {
  return {
    subject: normalizeText(record.subject),
    summary: normalizeText(record.summary),
    assertion: normalizeText(record.assertion),
    tags: (record.tags ?? []).map((tag) => normalizeText(tag)).filter(Boolean)
  };
}

export function matchesRetrievalQuery(record: MemoryItem, query: string): boolean {
  const normalizedQuery = normalizeText(query);
  if (!normalizedQuery) return true;

  if (subjectSemanticMatches(record, normalizedQuery)) {
    return true;
  }

  const fields = buildSearchFields(record);
  const queryTokens = tokenize(normalizedQuery, { dropStopwords: true });
  if (queryTokens.length === 0) return true;

  const searchableParts = [fields.subject, fields.summary, fields.assertion, ...fields.tags].filter(Boolean);
  const searchableText = searchableParts.join(" ");

  if (searchableText.includes(normalizedQuery)) {
    return true;
  }

  return queryTokens.every((token) => searchableParts.some((part) => tokenize(part).includes(token) || part.includes(token)));
}

function isRetrievable(record: MemoryItem, includeSuppressed: boolean): boolean {
  if (["invalid", "inactive", "superseded"].includes(record.status)) {
    return false;
  }

  if (!includeSuppressed && record.state === "suppressed") {
    return false;
  }

  return true;
}

function passesInjectionGate(record: MemoryItem, query: string): boolean {
  if (record.truth_class === "policy" || record.truth_class === "decision" || record.truth_class === "environment") {
    return true;
  }

  if (record.subject === "current-focus") {
    const focus = assessCurrentFocus(record);
    if (!focus.valid && !query.trim()) return false;
  }

  const signal = assessMemorySignal(record);
  if (!signal.injectable && !query.trim()) {
    return false;
  }

  return true;
} 

function scopeScoreForRecord(record: MemoryItem, requestedScopes: string[]): number {
  return calculateScopeScore(record.scope, requestedScopes);
}

function calculateQueryScore(record: MemoryItem, query: string): number {
  const normalizedQuery = normalizeText(query);
  if (!normalizedQuery) return 0;

  const fields = buildSearchFields(record);
  const policy = getRetrievalPolicy();
  if (!matchesRetrievalQuery(record, normalizedQuery)) return 0;
  if (fields.subject === normalizedQuery) return policy.exactSubjectQueryScore;
  if (subjectSemanticMatches(record, normalizedQuery)) return policy.exactSubjectQueryScore;
  if (fields.summary.includes(normalizedQuery)) return policy.summaryQueryScore;
  if (fields.assertion.includes(normalizedQuery)) return policy.assertionQueryScore;
  if (fields.tags.some((tag) => tag === normalizedQuery || tag.includes(normalizedQuery))) return policy.tagQueryScore;
  return policy.partialQueryScore;
}

function rankRecords(records: MemoryItem[], requestedScopes: string[], query: string): MemoryItem[] {
  return [...records].sort((a, b) => {
    const aScopeScore = scopeScoreForRecord(a, requestedScopes);
    const bScopeScore = scopeScoreForRecord(b, requestedScopes);
    if (bScopeScore !== aScopeScore) return bScopeScore - aScopeScore;

    const aSubjectPriority = subjectPriority(a.subject);
    const bSubjectPriority = subjectPriority(b.subject);
    if (bSubjectPriority !== aSubjectPriority) return bSubjectPriority - aSubjectPriority;

    const aQueryScore = calculateQueryScore(a, query);
    const bQueryScore = calculateQueryScore(b, query);
    if (bQueryScore !== aQueryScore) return bQueryScore - aQueryScore;

    if (b.importance !== a.importance) return b.importance - a.importance;
    if (b.retrieval_weight !== a.retrieval_weight) return b.retrieval_weight - a.retrieval_weight;
    if (b.confidence !== a.confidence) return b.confidence - a.confidence;

    return a.id.localeCompare(b.id);
  });
}

export function buildRetrievalSet(records: MemoryItem[], options: BuildRetrievalSetOptions = {}): RetrievalSet {
  const {
    limit = 8,
    activeLimit = 4,
    durableLimit = 4,
    policyLimit = 3,
    requestedScopes = [],
    query = "",
    includeSuppressed = false
  } = options;

  const eligible = records
    .filter((record) => isRetrievable(record, includeSuppressed))
    .filter((record) => matchesRetrievalQuery(record, query))
    .filter((record) => passesInjectionGate(record, query));
  const policies = rankRecords(
    eligible.filter((record) => record.truth_class === "policy"),
    requestedScopes,
    query
  ).slice(0, policyLimit);

  const active = rankRecords(
    eligible.filter((record) => record.state === "active" && record.truth_class !== "policy"),
    requestedScopes,
    query
  ).slice(0, Math.min(activeLimit, limit));

  const remainingSlots = Math.max(limit - active.length, 0);
  const durable = rankRecords(
    eligible.filter((record) => record.state === "durable" && record.truth_class !== "policy"),
    requestedScopes,
    query
  ).slice(0, Math.min(durableLimit, remainingSlots));

  const notesParts: string[] = [];
  if (requestedScopes.length > 0) {
    notesParts.push(`scoped to ${requestedScopes.length} requested scope(s)`);
  }
  if (query) {
    notesParts.push(`ranked against query '${query}'`);
  }
  if (durable.length > 0) {
    notesParts.push("durable memory included after active results");
  }
  if (policies.length > 0) {
    notesParts.push("policy memories surfaced separately");
  }

  return {
    active,
    durable,
    policies,
    suppressedConsidered: includeSuppressed,
    notes: notesParts.length > 0 ? notesParts.join("; ") : null
  };
}
