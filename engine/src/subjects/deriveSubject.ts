import type { MemoryCandidate } from "../candidates/deriveCandidate.js";
import type { MemoryItem, MemoryTruthClass } from "../types/MemoryItem.js";

function normalizeText(value: string | null | undefined): string {
  return (value ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function includesPhrase(text: string, phrases: string[]): boolean {
  return phrases.some((phrase) => text.includes(phrase));
}

function deriveSubjectFromFields(input: {
  truthClass: MemoryTruthClass;
  summary: string;
  assertion: string;
  notes?: string | null;
  tags?: string[];
}): string | null {
  const summary = normalizeText(input.summary);
  const assertion = normalizeText(input.assertion);
  const notes = normalizeText(input.notes);
  const tags = new Set((input.tags ?? []).map((tag) => normalizeText(tag)));

  if (input.truthClass === "decision") {
    if (includesPhrase(summary, ["priority", "prioritized", "priority order"])) return "priority-order";
    return "decision";
  }

  if (input.truthClass === "policy") {
    return "policy";
  }

  if (tags.has("current-focus") || includesPhrase(summary, ["current focus"]) || includesPhrase(assertion, ["current active work"])) {
    return "current-focus";
  }

  if (tags.has("blocker") || includesPhrase(summary, ["blocker", "blocked by"]) || includesPhrase(assertion, ["blocked by"])) {
    return "blocker";
  }

  if (input.truthClass === "environment") {
    if (includesPhrase(summary, ["machine", "device", "host", "laptop", "surface"])) return "machine";
    return "environment";
  }

  if (input.truthClass === "project") {
    if (includesPhrase(summary, ["mount model", "workspace", "repo structure", "project structure"])) return "project-structure";
    return "project";
  }

  if (input.truthClass === "preference") {
    return "preference";
  }

  if (input.truthClass === "relationship") {
    return "interaction-pattern";
  }

  if (notes.includes("focus")) return "current-focus";
  return null;
}

export function deriveCandidateSubject(candidate: MemoryCandidate): string | null {
  return deriveSubjectFromFields({
    truthClass: candidate.truth_class,
    summary: candidate.summary,
    assertion: candidate.assertion,
    notes: candidate.notes,
    tags: candidate.tags ?? []
  });
}

export function deriveMemoryItemSubject(item: Pick<MemoryItem, "truth_class" | "summary" | "assertion" | "tags">): string | null {
  return deriveSubjectFromFields({
    truthClass: item.truth_class,
    summary: item.summary,
    assertion: item.assertion,
    tags: item.tags
  });
}

export function normalizeSubject(value: string | null | undefined): string {
  return normalizeText(value);
}

export { isExclusiveOperationalSubject, subjectPriority } from "../policy/subjectPolicy.js";
