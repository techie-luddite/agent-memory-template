import { readFile } from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import Ajv2020Module, { type ValidateFunction } from "ajv/dist/2020.js";
import addFormatsModule from "ajv-formats";

export type MemoryEventType =
  | "user-statement"
  | "tool-observation"
  | "decision"
  | "task-status"
  | "error"
  | "resolution"
  | "environment-confirmation";

export interface MemoryEventSource {
  kind: string;
  session: string | null;
  workspace: string | null;
  files?: string[];
  [key: string]: unknown;
}

export interface MemoryEvent {
  id: string;
  timestamp: string;
  type: MemoryEventType;
  source: MemoryEventSource;
  summary: string;
  details?: object | unknown[] | string | null;
  tags?: string[];
}

export interface RecordEventInput {
  type: MemoryEventType;
  source: MemoryEventSource;
  summary: string;
  details?: object | unknown[] | string | null;
  tags?: string[];
  timestamp?: string;
  id?: string;
}

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48) || "event";
}

function compactTimestamp(timestamp: string): string {
  return timestamp.replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z").replace(/T/, "T");
}

function shortHash(value: string): string {
  return createHash("sha1").update(value).digest("hex").slice(0, 8);
}

function buildEventId(timestamp: string, summary: string, source: MemoryEventSource, type: MemoryEventType): string {
  const compact = compactTimestamp(timestamp);
  const slug = slugify(summary);
  const fingerprint = shortHash(JSON.stringify({ timestamp, summary, source, type }));
  return `evt_${compact}_${slug}_${fingerprint}`;
}

export async function createMemoryEventValidator(memoryRoot: string): Promise<ValidateFunction<MemoryEvent>> {
  const schemaPath = path.join(memoryRoot, "schemas", "event.schema.json");
  const rawSchema = await readFile(schemaPath, "utf8");
  const schema = JSON.parse(rawSchema) as object;
  const Ajv = Ajv2020Module.default ?? Ajv2020Module;
  const addFormats = addFormatsModule.default ?? addFormatsModule;
  const ajv = new Ajv({ allErrors: true, strict: false });
  addFormats(ajv);
  return ajv.compile<MemoryEvent>(schema);
}

export function validateMemoryEvent(
  event: MemoryEvent,
  validator: ValidateFunction<MemoryEvent>
): string[] {
  const errors: string[] = [];
  const valid = validator(event);

  if (!valid && validator.errors) {
    for (const error of validator.errors) {
      const location = error.instancePath || "/";
      errors.push(`schema ${location} ${error.message ?? "is invalid"}`);
    }
  }

  return errors;
}

export function recordEvent(input: RecordEventInput): MemoryEvent {
  const timestamp = input.timestamp ?? new Date().toISOString();
  return {
    id: input.id ?? buildEventId(timestamp, input.summary, input.source, input.type),
    timestamp,
    type: input.type,
    source: input.source,
    summary: input.summary,
    details: input.details ?? null,
    tags: input.tags ?? []
  };
}
