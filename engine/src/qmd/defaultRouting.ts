import type { SearchQmdMemoryQuery } from "./searchQmdMemory.js";

export interface BuildDefaultQmdQueryInput {
  prompt: string;
}

function normalize(text: string): string {
  return text.trim().toLowerCase();
}

function isFocusPrompt(text: string): boolean {
  return [
    "what are we focused on",
    "what's the current focus",
    "whats the current focus",
    "what is the current focus",
    "what were we working on",
    "what are we working on",
    "what we were working on",
    "current focus"
  ].some((phrase) => text.includes(phrase));
}

function isMemoryCapturePolicyPrompt(text: string): boolean {
  return (
    (text.includes("memory capture") || text.includes("capture work") || text.includes("capture workflow")) &&
    (text.includes("how should") || text.includes("how are") || text.includes("supposed to") || text.includes("work here"))
  );
}

function isPolicyPrompt(text: string): boolean {
  return (
    text.includes("policy") ||
    text.includes("how should") ||
    text.includes("what did we decide") ||
    text.includes("non-negotiable") ||
    text.includes("operating model")
  );
}

export function buildDefaultQmdQuery(input: BuildDefaultQmdQueryInput): SearchQmdMemoryQuery {
  const prompt = input.prompt.trim();
  const normalized = normalize(prompt);

  if (isFocusPrompt(normalized)) {
    return {
      query: prompt,
      mode: "hybrid",
      collections: ["memory-active"],
      intent: "retrieve the current active operational focus from Agent Memory Template memory",
      rerank: false,
      limit: 5
    };
  }

  if (isMemoryCapturePolicyPrompt(normalized)) {
    return {
      query: prompt,
      mode: "hybrid",
      collections: ["memory-policy", "memory-durable"],
      intent: "retrieve workspace policy and decisions about memory capture workflow and autopromotion",
      rerank: false,
      limit: 5
    };
  }

  if (isPolicyPrompt(normalized)) {
    return {
      query: prompt,
      mode: "hybrid",
      collections: ["memory-policy", "memory-durable"],
      intent: "retrieve workspace policy and durable decision memory relevant to the user prompt",
      rerank: false,
      limit: 5
    };
  }

  return {
    query: prompt,
    mode: "hybrid",
    collections: ["memory-active", "memory-durable", "memory-policy"],
    intent: "retrieve continuity-bearing memory relevant to the current user prompt",
    rerank: false,
    limit: 5
  };
}
