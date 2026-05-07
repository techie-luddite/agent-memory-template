import type { LoadedMemoryRecord, MemoryItem } from "../types/MemoryItem.js";

export type ReviewStatus = "ok" | "due" | "overdue" | "no-threshold";

export interface ActiveMemoryAuditRecord {
  id: string;
  truth_class: string;
  subject: string | null;
  summary: string;
  scope: string[];
  review_status: ReviewStatus;
  review_reasons: string[];
  reinforcement_count: number;
  last_reinforced_at: string | null;
  review_after_sessions: number | null;
  review_after_interactions: number | null;
  activity_state: string | null;
}

export interface ActiveMemoryAuditOptions {
  sessionsSinceReinforcement?: number;
  interactionsSinceReinforcement?: number;
}

export interface ActiveMemoryAuditSummary {
  total_active: number;
  ok: number;
  due: number;
  overdue: number;
  no_threshold: number;
}

export interface ActiveMemoryAuditResult {
  options: {
    sessions_elapsed: number | null;
    interactions_elapsed: number | null;
  };
  summary: ActiveMemoryAuditSummary;
  records: ActiveMemoryAuditRecord[];
  needs_attention: boolean;
}

function resolveReviewStatus(
  item: MemoryItem,
  sessionsSinceReinforcement: number | null,
  interactionsSinceReinforcement: number | null
): { status: ReviewStatus; reasons: string[] } {
  const hasSessionThreshold = typeof item.review_after_sessions === "number";
  const hasInteractionThreshold = typeof item.review_after_interactions === "number";

  if (!hasSessionThreshold && !hasInteractionThreshold) {
    return { status: "no-threshold", reasons: ["no review thresholds set"] };
  }

  const reasons: string[] = [];

  if (
    hasSessionThreshold &&
    sessionsSinceReinforcement !== null &&
    sessionsSinceReinforcement > (item.review_after_sessions as number) * 1.5
  ) {
    reasons.push(
      `overdue: ${sessionsSinceReinforcement} sessions elapsed, threshold is ${item.review_after_sessions}`
    );
  } else if (
    hasSessionThreshold &&
    sessionsSinceReinforcement !== null &&
    sessionsSinceReinforcement >= (item.review_after_sessions as number)
  ) {
    reasons.push(
      `due: ${sessionsSinceReinforcement} sessions elapsed, threshold is ${item.review_after_sessions}`
    );
  }

  if (
    hasInteractionThreshold &&
    interactionsSinceReinforcement !== null &&
    interactionsSinceReinforcement > (item.review_after_interactions as number) * 1.5
  ) {
    reasons.push(
      `overdue: ${interactionsSinceReinforcement} interactions elapsed, threshold is ${item.review_after_interactions}`
    );
  } else if (
    hasInteractionThreshold &&
    interactionsSinceReinforcement !== null &&
    interactionsSinceReinforcement >= (item.review_after_interactions as number)
  ) {
    reasons.push(
      `due: ${interactionsSinceReinforcement} interactions elapsed, threshold is ${item.review_after_interactions}`
    );
  }

  if (reasons.length === 0 && (sessionsSinceReinforcement === null && interactionsSinceReinforcement === null)) {
    return { status: "no-threshold", reasons: ["no elapsed counts provided — cannot evaluate thresholds"] };
  }

  if (reasons.length === 0) {
    return { status: "ok", reasons: [] };
  }

  const isOverdue = reasons.some((r) => r.startsWith("overdue"));
  return { status: isOverdue ? "overdue" : "due", reasons };
}

export function auditActiveMemory(
  records: LoadedMemoryRecord[],
  options: ActiveMemoryAuditOptions = {}
): ActiveMemoryAuditResult {
  const {
    sessionsSinceReinforcement = null,
    interactionsSinceReinforcement = null
  } = options;

  const activeRecords = records.filter(
    (r) => r.item.state === "active" && r.item.status === "confirmed"
  );

  const audited: ActiveMemoryAuditRecord[] = activeRecords.map((r) => {
    const { status, reasons } = resolveReviewStatus(
      r.item,
      sessionsSinceReinforcement,
      interactionsSinceReinforcement
    );

    return {
      id: r.item.id,
      truth_class: r.item.truth_class,
      subject: r.item.subject ?? null,
      summary: r.item.summary,
      scope: r.item.scope,
      review_status: status,
      review_reasons: reasons,
      reinforcement_count: r.item.reinforcement_count ?? 0,
      last_reinforced_at: r.item.last_reinforced_at ?? null,
      review_after_sessions: r.item.review_after_sessions ?? null,
      review_after_interactions: r.item.review_after_interactions ?? null,
      activity_state: r.item.activity_state ?? null
    };
  });

  const summary: ActiveMemoryAuditSummary = {
    total_active: audited.length,
    ok: audited.filter((r) => r.review_status === "ok").length,
    due: audited.filter((r) => r.review_status === "due").length,
    overdue: audited.filter((r) => r.review_status === "overdue").length,
    no_threshold: audited.filter((r) => r.review_status === "no-threshold").length
  };

  return {
    options: {
      sessions_elapsed: sessionsSinceReinforcement,
      interactions_elapsed: interactionsSinceReinforcement
    },
    summary,
    records: audited,
    needs_attention: summary.due > 0 || summary.overdue > 0
  };
}
