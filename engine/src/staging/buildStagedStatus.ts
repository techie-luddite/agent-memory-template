import { primarySourceEventId, type MemoryCandidate } from "../candidates/deriveCandidate.js";
import type { MemoryEvent } from "../events/recordEvent.js";
import type { StagedRecord } from "./stagingStore.js";

export interface StagedCandidateStatus {
  id: string;
  file: string;
  source_event_id: string | null;
  source_event_present: boolean;
  validation_errors: string[];
  suppression: {
    suppress: boolean;
    reasons: string[];
  } | null;
  promotion: {
    target: "active" | "durable" | "suppressed" | "discard";
    reasons: string[];
  } | null;
}

export interface StagedStatusReport {
  events: Array<{
    id: string;
    file: string;
    validation_errors: string[];
  }>;
  candidates: StagedCandidateStatus[];
  summary: {
    event_count: number;
    candidate_count: number;
    valid_events: number;
    valid_candidates: number;
    promotable_candidates: number;
    suppressed_candidates: number;
    discarded_candidates: number;
    invalid_candidates: number;
    candidates_missing_source_event: number;
  };
}

export function buildStagedStatusReport(input: {
  events: Array<StagedRecord<MemoryEvent> & { validationErrors: string[] }>;
  candidates: Array<
    StagedRecord<MemoryCandidate> & {
      validationErrors: string[];
      sourceEventPresent: boolean;
      suppression: { suppress: boolean; reasons: string[] } | null;
      promotion: { target: "active" | "durable" | "suppressed" | "discard"; reasons: string[] } | null;
    }
  >;
}): StagedStatusReport {
  const events = input.events.map((record) => ({
    id: record.id,
    file: record.filePath,
    validation_errors: record.validationErrors
  }));

  const candidates = input.candidates.map((record) => ({
    id: record.id,
    file: record.filePath,
    source_event_id: primarySourceEventId(record.payload),
    source_event_present: record.sourceEventPresent,
    validation_errors: record.validationErrors,
    suppression: record.suppression,
    promotion: record.promotion
  }));

  const promotableCandidates = candidates.filter(
    (candidate) => candidate.validation_errors.length === 0 && candidate.promotion && candidate.promotion.target !== "discard"
  ).length;
  const suppressedCandidates = candidates.filter((candidate) => candidate.promotion?.target === "suppressed").length;
  const discardedCandidates = candidates.filter((candidate) => candidate.promotion?.target === "discard").length;
  const invalidCandidates = candidates.filter((candidate) => candidate.validation_errors.length > 0).length;
  const candidatesMissingSourceEvent = candidates.filter((candidate) => !candidate.source_event_present).length;

  return {
    events,
    candidates,
    summary: {
      event_count: events.length,
      candidate_count: candidates.length,
      valid_events: events.filter((event) => event.validation_errors.length === 0).length,
      valid_candidates: candidates.filter((candidate) => candidate.validation_errors.length === 0).length,
      promotable_candidates: promotableCandidates,
      suppressed_candidates: suppressedCandidates,
      discarded_candidates: discardedCandidates,
      invalid_candidates: invalidCandidates,
      candidates_missing_source_event: candidatesMissingSourceEvent
    }
  };
}
