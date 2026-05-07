import { mkdir, rename, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import type { MemoryCandidate } from "../candidates/deriveCandidate.js";
import type { MemoryEvent } from "../events/recordEvent.js";
import { reviewDefaultsForState } from "../policy/lifecyclePolicy.js";
import { isExclusiveOperationalSubject } from "../policy/subjectPolicy.js";
import { getTruthClassPolicy, type TruthClassPolicy } from "../policy/truthClassPolicy.js";
import { deriveCandidateSubject, normalizeSubject } from "../subjects/deriveSubject.js";
import type { LoadedMemoryRecord, MemoryItem, MemoryState } from "../types/MemoryItem.js";

export interface MaterializeCandidateInput {
  candidate: MemoryCandidate;
  targetState: Exclude<MemoryState, never>;
  sourceEvent?: MemoryEvent;
  sessionId?: string | null;
}

export interface MaterializedMemoryRecord {
  item: MemoryItem;
  filePath: string;
}

export interface CandidateReconciliationDecision {
  action: "create" | "reinforce" | "supersede";
  existing?: LoadedMemoryRecord;
  reason: string;
  score?: number;
}

export interface CandidateReconciliationResult {
  decision: CandidateReconciliationDecision;
  materialized: MaterializedMemoryRecord;
  superseded?: MaterializedMemoryRecord;
}

function clamp(value: number, min = 0, max = 1): number {
  return Math.max(min, Math.min(max, value));
}

function stateRank(state: MemoryState): number {
  switch (state) {
    case "durable":
      return 3;
    case "active":
      return 2;
    case "suppressed":
      return 1;
  }
}

function deriveSubject(candidate: MemoryCandidate): string | null {
  return deriveCandidateSubject(candidate);
}

function deriveTags(candidate: MemoryCandidate, targetState: MemoryState): string[] {
  const tags = new Set<string>(candidate.tags ?? []);

  tags.add(candidate.truth_class);
  tags.add(targetState);

  if (candidate.notes) {
    const normalized = candidate.notes.toLowerCase();
    if (normalized.includes("decision")) tags.add("decision");
    if (normalized.includes("policy")) tags.add("policy");
    if (normalized.includes("focus")) tags.add("current-focus");
  }

  if (candidate.summary.toLowerCase().includes("current focus")) {
    tags.add("current-focus");
  }

  return [...tags].sort((a, b) => a.localeCompare(b));
}

function normalizeText(text: string | null | undefined): string {
  return normalizeSubject(text);
}

function tokenize(text: string): string[] {
  return normalizeText(text)
    .split(" ")
    .map((token) => token.trim())
    .filter((token) => token.length > 2);
}

function jaccardSimilarity(a: string, b: string): number {
  const aTokens = new Set(tokenize(a));
  const bTokens = new Set(tokenize(b));

  if (aTokens.size === 0 || bTokens.size === 0) return 0;

  let intersection = 0;
  for (const token of aTokens) {
    if (bTokens.has(token)) intersection += 1;
  }

  const union = new Set([...aTokens, ...bTokens]).size;
  return union === 0 ? 0 : intersection / union;
}

function hasScopeOverlap(left: string[], right: string[]): boolean {
  return left.some((scope) => right.includes(scope));
}

function pathForItem(memoryRoot: string, item: MemoryItem): string {
  return path.join(memoryRoot, item.state, item.truth_class, `${item.id}.json`);
}

function candidateSubject(candidate: MemoryCandidate): string | null {
  return deriveSubject(candidate);
}

function subjectMatches(existing: LoadedMemoryRecord, candidate: MemoryCandidate, policy: TruthClassPolicy): boolean {
  if (!policy.reinforceBySubject) return false;
  const existingSubject = normalizeSubject(existing.item.subject);
  const derivedCandidateSubject = normalizeSubject(candidateSubject(candidate));
  if (!existingSubject || !derivedCandidateSubject) return false;
  return existingSubject === derivedCandidateSubject;
}

function subjectIsExclusive(existing: LoadedMemoryRecord, candidate: MemoryCandidate, policy: TruthClassPolicy): boolean {
  if (!policy.subjectExclusive) return false;
  if (!subjectMatches(existing, candidate, policy)) return false;

  if (candidate.truth_class === "operational") {
    return isExclusiveOperationalSubject(candidateSubject(candidate));
  }

  return true;
}

function duplicateMatch(existing: LoadedMemoryRecord, candidate: MemoryCandidate, policy: TruthClassPolicy): boolean {
  const sameSummary = normalizeText(existing.item.summary) === normalizeText(candidate.summary);
  const sameAssertion = normalizeText(existing.item.assertion) === normalizeText(candidate.assertion);

  if (policy.duplicateSummaryMatch && sameSummary) return true;
  if (policy.duplicateAssertionMatch && sameAssertion) return true;
  if (subjectMatches(existing, candidate, policy) && (sameSummary || sameAssertion)) return true;
  return false;
}

function supersedeScore(existing: LoadedMemoryRecord, candidate: MemoryCandidate, policy: TruthClassPolicy): number {
  const summaryScore = jaccardSimilarity(existing.item.summary, candidate.summary);
  const assertionScore = jaccardSimilarity(existing.item.assertion, candidate.assertion);
  const scopeBonus = hasScopeOverlap(existing.item.scope, candidate.scope) ? 0.08 : 0;
  const subjectBonus = subjectMatches(existing, candidate, policy) ? 0.18 : 0;
  return Math.max(summaryScore, assertionScore) + scopeBonus + subjectBonus;
}

async function atomicWriteJson(filePath: string, payload: unknown): Promise<void> {
  const dir = path.dirname(filePath);
  const tempPath = path.join(dir, `.${path.basename(filePath)}.tmp-${process.pid}-${Date.now()}`);
  await writeFile(tempPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  await rename(tempPath, filePath);
}

async function writeMemoryItem(memoryRoot: string, item: MemoryItem): Promise<MaterializedMemoryRecord> {
  const filePath = pathForItem(memoryRoot, item);
  await mkdir(path.dirname(filePath), { recursive: true });
  await atomicWriteJson(filePath, item);
  return { item, filePath };
}

async function removeIfMoved(previousPath: string, nextPath: string): Promise<void> {
  if (previousPath === nextPath) return;

  try {
    await unlink(previousPath);
  } catch {
    // ignore missing prior files
  }
}

function buildMemoryItem(input: MaterializeCandidateInput): MemoryItem {
  const { candidate, targetState, sourceEvent, sessionId = null } = input;
  const timestamp = candidate.created_at;
  const confidence = clamp(candidate.confidence);
  const importance = clamp(candidate.significance);
  const retrievalWeight = clamp((candidate.confidence + candidate.significance) / 2);
  const subject = deriveSubject(candidate);

  const reviewDefaults = reviewDefaultsForState(targetState);

  return {
    id: candidate.id.replace(/^cand_/, "mem_"),
    state: targetState,
    truth_class: candidate.truth_class,
    scope: candidate.scope,
    subject,
    summary: candidate.summary,
    assertion: candidate.assertion,
    confidence,
    importance,
    retrieval_weight: retrievalWeight,
    status: "confirmed",
    source: {
      type: "candidate-promotion",
      session: sessionId,
      evidence: [...candidate.derived_from],
      candidate_id: candidate.id,
      source_event_id: sourceEvent?.id ?? null
    },
    created_at: timestamp,
    updated_at: timestamp,
    last_reinforced_at: timestamp,
    last_reinforced_in_session: sessionId,
    reinforcement_count: 1,
    review_after_sessions: reviewDefaults.review_after_sessions,
    review_after_interactions: reviewDefaults.review_after_interactions,
    activity_state: reviewDefaults.activity_state,
    supersedes: [],
    superseded_by: null,
    tags: deriveTags(candidate, targetState)
  };
}

export function reconcileCandidateAgainstExisting(
  candidate: MemoryCandidate,
  existingRecords: LoadedMemoryRecord[]
): CandidateReconciliationDecision {
  const policy = getTruthClassPolicy(candidate.truth_class);
  const relevantRecords = existingRecords.filter((record) => {
    if (record.item.truth_class !== candidate.truth_class) return false;
    if (record.item.status !== "confirmed") return false;
    if (!hasScopeOverlap(record.item.scope, candidate.scope)) return false;
    return true;
  });

  const duplicateCandidates = relevantRecords.filter((record) => duplicateMatch(record, candidate, policy));

  if (duplicateCandidates.length > 0) {
    const existing = duplicateCandidates.sort((a, b) => stateRank(b.item.state) - stateRank(a.item.state))[0];
    return {
      action: "reinforce",
      existing,
      reason: subjectMatches(existing, candidate, policy)
        ? "matching memory already exists for this candidate subject"
        : "matching memory already exists for this candidate"
    };
  }

  if (policy.subjectExclusive) {
    const exclusiveSubjectMatches = relevantRecords.filter((record) => subjectIsExclusive(record, candidate, policy));
    if (exclusiveSubjectMatches.length > 0) {
      const existing = exclusiveSubjectMatches.sort((a, b) => stateRank(b.item.state) - stateRank(a.item.state))[0];
      return {
        action: "supersede",
        existing,
        reason: "candidate replaces the current exclusive subject-bound operational memory",
        score: 1
      };
    }
  }

  if (policy.allowSupersede) {
    const supersedeCandidates = relevantRecords
      .filter((record) => record.item.state !== "suppressed")
      .map((record) => ({
        record,
        score: supersedeScore(record, candidate, policy)
      }))
      .filter(({ score }) => score >= policy.supersedeThreshold)
      .sort((a, b) => b.score - a.score);

    if (supersedeCandidates.length > 0) {
      return {
        action: "supersede",
        existing: supersedeCandidates[0].record,
        reason: "candidate appears to revise an existing memory",
        score: supersedeCandidates[0].score
      };
    }
  }

  return {
    action: "create",
    reason: "no conflicting memory found"
  };
}

async function reinforceExistingMemory(
  memoryRoot: string,
  existing: LoadedMemoryRecord,
  input: MaterializeCandidateInput
): Promise<MaterializedMemoryRecord> {
  const mergedEvidence = [...new Set([...(existing.item.source.evidence ?? []), ...input.candidate.derived_from])];
  const mergedTags = [...new Set([...(existing.item.tags ?? []), ...deriveTags(input.candidate, existing.item.state)])].sort((a, b) =>
    a.localeCompare(b)
  );
  const targetState = stateRank(input.targetState) > stateRank(existing.item.state) ? input.targetState : existing.item.state;
  const nextSubject = deriveSubject(input.candidate) ?? existing.item.subject ?? null;

  const reviewDefaults = reviewDefaultsForState(targetState);

  const updated: MemoryItem = {
    ...existing.item,
    state: targetState,
    subject: nextSubject,
    scope: [...new Set([...existing.item.scope, ...input.candidate.scope])],
    confidence: Math.max(existing.item.confidence, clamp(input.candidate.confidence)),
    importance: Math.max(existing.item.importance, clamp(input.candidate.significance)),
    retrieval_weight: Math.max(existing.item.retrieval_weight, clamp((input.candidate.confidence + input.candidate.significance) / 2)),
    source: {
      ...existing.item.source,
      session: input.sessionId ?? existing.item.source.session ?? null,
      evidence: mergedEvidence,
      candidate_id: input.candidate.id,
      source_event_id: input.sourceEvent?.id ?? existing.item.source.source_event_id ?? null
    },
    updated_at: input.candidate.created_at,
    last_reinforced_at: input.candidate.created_at,
    last_reinforced_in_session: input.sessionId ?? existing.item.last_reinforced_in_session ?? null,
    reinforcement_count: (existing.item.reinforcement_count ?? 0) + 1,
    review_after_sessions: targetState === "active" ? existing.item.review_after_sessions ?? reviewDefaults.review_after_sessions : null,
    review_after_interactions:
      targetState === "active" ? existing.item.review_after_interactions ?? reviewDefaults.review_after_interactions : null,
    activity_state: targetState === "active" ? existing.item.activity_state ?? reviewDefaults.activity_state : null,
    tags: mergedTags
  };

  const written = await writeMemoryItem(memoryRoot, updated);
  await removeIfMoved(existing.filePath, written.filePath);
  return written;
}

async function supersedeExistingMemory(
  memoryRoot: string,
  existing: LoadedMemoryRecord,
  input: MaterializeCandidateInput
): Promise<{ superseded: MaterializedMemoryRecord; replacement: MaterializedMemoryRecord }> {
  const replacementItem = buildMemoryItem(input);
  replacementItem.supersedes = [...new Set([...(replacementItem.supersedes ?? []), existing.item.id])];

  const supersededItem: MemoryItem = {
    ...existing.item,
    state: "suppressed",
    status: "superseded",
    updated_at: input.candidate.created_at,
    superseded_by: replacementItem.id,
    activity_state: null,
    review_after_sessions: null,
    review_after_interactions: null,
    tags: [...new Set([...(existing.item.tags ?? []), "superseded", "suppressed"])].sort((a, b) => a.localeCompare(b))
  };

  const superseded = await writeMemoryItem(memoryRoot, supersededItem);
  await removeIfMoved(existing.filePath, superseded.filePath);
  const replacement = await writeMemoryItem(memoryRoot, replacementItem);

  return { superseded, replacement };
}

export async function materializeCandidate(
  memoryRoot: string,
  input: MaterializeCandidateInput
): Promise<MaterializedMemoryRecord> {
  const item = buildMemoryItem(input);
  return writeMemoryItem(memoryRoot, item);
}

export async function reconcileAndMaterializeCandidate(
  memoryRoot: string,
  input: MaterializeCandidateInput,
  existingRecords: LoadedMemoryRecord[]
): Promise<CandidateReconciliationResult> {
  const decision = reconcileCandidateAgainstExisting(input.candidate, existingRecords);

  if (decision.action === "reinforce" && decision.existing) {
    return {
      decision,
      materialized: await reinforceExistingMemory(memoryRoot, decision.existing, input)
    };
  }

  if (decision.action === "supersede" && decision.existing) {
    const { superseded, replacement } = await supersedeExistingMemory(memoryRoot, decision.existing, input);
    return {
      decision,
      materialized: replacement,
      superseded
    };
  }

  return {
    decision,
    materialized: await materializeCandidate(memoryRoot, input)
  };
}
