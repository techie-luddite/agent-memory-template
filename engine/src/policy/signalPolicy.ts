type SignalCandidate = {
  summary: string;
  assertion?: string;
  truth_class?: string;
  tags?: string[];
};

export interface MemorySignalAssessment {
  injectable: boolean;
  noisy: boolean;
  reasons: string[];
}

const TOOL_NOISE_PATTERNS: RegExp[] = [
  /^successfully (wrote|replaced|created|removed) \d+ /i,
  /^session dispatched/i,
  /^command exited with code \d+/i,
  /^path not found:/i,
  /^traceback \(most recent call last\):/i,
  /^total \d+\s+/i,
  /^url: https?:\/\//i,
  /^intercom\.sessions ok/i
];

function normalizedText(candidate: SignalCandidate): string {
  return `${candidate.summary ?? ""}\n${candidate.assertion ?? ""}`.trim();
}

function hasTag(candidate: SignalCandidate, tag: string): boolean {
  return (candidate.tags ?? []).some((candidateTag) => candidateTag.toLowerCase() === tag);
}

function looksLikeRawBlob(text: string): boolean {
  const lines = text.split(/\r?\n/).filter((line) => line.trim().length > 0);
  if (lines.length >= 8) return true;
  if (text.length > 900 && /(?:\{|\}|\/home\/|\.ts:|\.js:|drwx|^-rw-)/m.test(text)) return true;
  return false;
}

function looksTrivial(text: string): boolean {
  const words = text.trim().split(/\s+/).filter(Boolean);
  if (words.length <= 5 && !/[.!?].*[.!?]/.test(text)) return true;
  return false;
}

export function assessMemorySignal(candidate: SignalCandidate): MemorySignalAssessment {
  const text = normalizedText(candidate);
  const reasons: string[] = [];

  if (!text) {
    return { injectable: false, noisy: true, reasons: ["empty memory text"] };
  }

  if (hasTag(candidate, "important") || hasTag(candidate, "durable") || hasTag(candidate, "decision") || candidate.truth_class === "policy") {
    return { injectable: true, noisy: false, reasons: ["explicitly marked as durable/important signal"] };
  }

  for (const pattern of TOOL_NOISE_PATTERNS) {
    if (pattern.test(text)) {
      reasons.push("matches transient tool/status output pattern");
      break;
    }
  }

  if (looksRawCommandListing(text)) reasons.push("looks like raw command or directory output");
  if (looksLikeRawBlob(text)) reasons.push("looks like an uncurated raw output blob");
  if (looksTrivial(text)) reasons.push("too short/trivial without explicit durable signal");

  const noisy = reasons.length > 0;
  return {
    injectable: !noisy,
    noisy,
    reasons
  };
}

function looksRawCommandListing(text: string): boolean {
  const rawMarkers = ["drwx", "-rw-", "┌──(", "Command exited with code", " at file://", "ModuleNotFoundError:"];
  return rawMarkers.some((marker) => text.includes(marker));
}
