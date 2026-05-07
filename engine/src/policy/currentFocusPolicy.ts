type FocusCandidate = {
  summary: string;
  assertion?: string;
  truth_class?: string;
  subject?: string | null;
  tags?: string[];
};

export interface CurrentFocusAssessment {
  valid: boolean;
  reasons: string[];
}

const CONTINUITY_PATTERNS: RegExp[] = [
  /\bcurrent focus\b/i,
  /\bactive work\b/i,
  /\bworking on\b/i,
  /\bleft off\b/i,
  /\bnext step\b/i,
  /\bcontinue\b/i,
  /\bresume\b/i,
  /\bimplement(?:ing)?\b/i,
  /\bfix(?:ing)?\b/i,
  /\bdebug(?:ging)?\b/i,
  /\bbuild(?:ing)?\b/i,
  /\bship(?:ping)?\b/i,
  /\bcleanup\b/i,
  /\brefactor(?:ing)?\b/i
];

const CASUAL_PROMPT_PATTERNS: RegExp[] = [
  /^say\b/i,
  /^what about\b/i,
  /^hello\??$/i,
  /^hi\??$/i,
  /^thanks?\b/i
];

function textFor(candidate: FocusCandidate): string {
  return `${candidate.summary ?? ""}\n${candidate.assertion ?? ""}`.trim();
}

function wordCount(text: string): number {
  return text.split(/\s+/).filter(Boolean).length;
}

function hasCurrentFocusSignal(candidate: FocusCandidate, text: string): boolean {
  const tags = new Set((candidate.tags ?? []).map((tag) => tag.toLowerCase()));
  return tags.has("current-focus") || CONTINUITY_PATTERNS.some((pattern) => pattern.test(text));
}

export function assessCurrentFocus(candidate: FocusCandidate): CurrentFocusAssessment {
  const text = textFor(candidate);
  const reasons: string[] = [];

  if (candidate.truth_class && candidate.truth_class !== "operational") {
    return { valid: true, reasons: ["not operational current-focus"] };
  }

  if (!hasCurrentFocusSignal(candidate, text)) {
    reasons.push("missing explicit task-continuity signal");
  }

  if (wordCount(text) < 6) {
    reasons.push("too short to anchor current focus");
  }

  if (CASUAL_PROMPT_PATTERNS.some((pattern) => pattern.test(candidate.summary.trim()))) {
    reasons.push("looks like a casual one-off prompt, not project focus");
  }

  return {
    valid: reasons.length === 0,
    reasons
  };
}
