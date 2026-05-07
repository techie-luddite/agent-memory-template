import { readFile } from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import Ajv2020Module, { type ValidateFunction } from "ajv/dist/2020.js";
import addFormatsModule from "ajv-formats";
import { subjectSignificanceBonus } from "../policy/subjectPolicy.js";
import type { MemoryTruthClass } from "../types/MemoryItem.js";
import type { MemoryEvent } from "../events/recordEvent.js";
import { deriveCandidateSubject } from "../subjects/deriveSubject.js";

export interface MemoryCandidate {
  id: string;
  derived_from: [string];
  truth_class: MemoryTruthClass;
  scope: string[];
  summary: string;
  assertion: string;
  confidence: number;
  significance: number;
  status: "pending" | "promoted-active" | "promoted-durable" | "discarded" | "suppressed";
  notes: string | null;
  tags?: string[];
  created_at: string;
}

export function primarySourceEventId(candidate: Pick<MemoryCandidate, "derived_from">): string {
  return candidate.derived_from[0];
}

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48) || "candidate";
}

function compactTimestamp(timestamp: string): string {
  return timestamp.replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z").replace(/T/, "T");
}

function shortHash(value: string): string {
  return createHash("sha1").update(value).digest("hex").slice(0, 8);
}

function mapTruthClass(event: MemoryEvent): MemoryTruthClass {
  const tags = new Set((event.tags ?? []).map((tag) => tag.toLowerCase()));

  if (tags.has("policy")) return "policy";
  if (tags.has("decision")) return "decision";
  if (tags.has("preference")) return "preference";
  if (tags.has("relationship")) return "relationship";
  if (tags.has("project")) return "project";
  if (tags.has("environment")) return "environment";

  switch (event.type) {
    case "decision":
      return "decision";
    case "environment-confirmation":
      return "environment";
    case "tool-observation":
      return tags.has("environment") ? "environment" : "project";
    case "task-status":
    case "error":
    case "resolution":
      return "operational";
    case "user-statement":
    default:
      return "operational";
  }
}

function deriveScope(event: MemoryEvent): string[] {
  const scopes: string[] = [];

  if (event.source.workspace) {
    scopes.push(`workspace:${event.source.workspace}`);
  }

  for (const tag of event.tags ?? []) {
    if (tag.startsWith("scope:")) {
      scopes.push(tag.slice("scope:".length));
    }
  }

  return scopes.length > 0 ? [...new Set(scopes)] : ["global"];
}

function deriveCandidateTags(event: MemoryEvent): string[] {
  return [...new Set((event.tags ?? []).filter((tag) => !tag.startsWith("scope:")))].sort((a, b) => a.localeCompare(b));
}

function deriveAssertion(event: MemoryEvent): string {
  if (typeof event.details === "string" && event.details.trim()) {
    return event.details.trim();
  }

  if (event.details && typeof event.details === "object") {
    return `${event.summary} Details: ${JSON.stringify(event.details)}`;
  }

  return event.summary;
}

function deriveConfidence(event: MemoryEvent): number {
  switch (event.type) {
    case "decision":
    case "environment-confirmation":
      return 0.95;
    case "resolution":
      return 0.9;
    case "tool-observation":
      return 0.82;
    case "task-status":
    case "error":
      return 0.78;
    case "user-statement":
    default:
      return 0.72;
  }
}

function deriveSignificance(event: MemoryEvent, truthClass: MemoryTruthClass): number {
  const tags = new Set((event.tags ?? []).map((tag) => tag.toLowerCase()));
  const subject = deriveCandidateSubject({
    id: "candidate-subject-preview",
    derived_from: [event.id],
    truth_class: truthClass,
    scope: deriveScope(event),
    summary: event.summary,
    assertion: deriveAssertion(event),
    confidence: 0,
    significance: 0,
    status: "pending",
    notes: `Derived from ${event.type}.`,
    created_at: event.timestamp
  });
  let significance = 0.55;

  if (truthClass === "policy" || truthClass === "decision") significance += 0.25;
  if (truthClass === "environment" || truthClass === "project") significance += 0.15;
  if (tags.has("important") || tags.has("durable")) significance += 0.15;
  significance += subjectSignificanceBonus(subject);

  return Math.min(significance, 0.98);
}

export async function createMemoryCandidateValidator(memoryRoot: string): Promise<ValidateFunction<MemoryCandidate>> {
  const schemaPath = path.join(memoryRoot, "schemas", "candidate.schema.json");
  const rawSchema = await readFile(schemaPath, "utf8");
  const schema = JSON.parse(rawSchema) as object;
  const Ajv = Ajv2020Module.default ?? Ajv2020Module;
  const addFormats = addFormatsModule.default ?? addFormatsModule;
  const ajv = new Ajv({ allErrors: true, strict: false });
  addFormats(ajv);
  return ajv.compile<MemoryCandidate>(schema);
}

export function validateMemoryCandidate(
  candidate: MemoryCandidate,
  validator: ValidateFunction<MemoryCandidate>
): string[] {
  const errors: string[] = [];
  const valid = validator(candidate);

  if (!valid && validator.errors) {
    for (const error of validator.errors) {
      const location = error.instancePath || "/";
      errors.push(`schema ${location} ${error.message ?? "is invalid"}`);
    }
  }

  return errors;
}

export function deriveCandidate(event: MemoryEvent): MemoryCandidate {
  const truthClass = mapTruthClass(event);
  const createdAt = event.timestamp;

  return {
    id: `cand_${compactTimestamp(createdAt)}_${slugify(event.summary)}_${shortHash(
      JSON.stringify({ eventId: event.id, createdAt, summary: event.summary, truthClass })
    )}`,
    derived_from: [event.id],
    truth_class: truthClass,
    scope: deriveScope(event),
    summary: event.summary,
    assertion: deriveAssertion(event),
    confidence: deriveConfidence(event),
    significance: deriveSignificance(event, truthClass),
    status: "pending",
    notes: `Derived from ${event.type}.`,
    tags: deriveCandidateTags(event),
    created_at: createdAt
  };
}
