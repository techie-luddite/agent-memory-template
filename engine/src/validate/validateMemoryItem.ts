import { readFile } from "node:fs/promises";
import path from "node:path";
import Ajv2020Module, { type ValidateFunction } from "ajv/dist/2020.js";
import addFormatsModule from "ajv-formats";
import type { LoadedMemoryRecord, MemoryItem, MemoryState, MemoryTruthClass } from "../types/MemoryItem.js";

export async function createMemoryItemValidator(memoryRoot: string): Promise<ValidateFunction<MemoryItem>> {
  const schemaPath = path.join(memoryRoot, "schemas", "memory-item.schema.json");
  const rawSchema = await readFile(schemaPath, "utf8");
  const schema = JSON.parse(rawSchema) as object;
  const Ajv = Ajv2020Module.default ?? Ajv2020Module;
  const addFormats = addFormatsModule.default ?? addFormatsModule;
  const ajv = new Ajv({ allErrors: true, strict: false });
  addFormats(ajv);
  return ajv.compile<MemoryItem>(schema);
}

export function validateMemoryItem(
  record: LoadedMemoryRecord,
  validator: ValidateFunction<MemoryItem>
): string[] {
  const errors: string[] = [];
  const { item } = record;

  const valid = validator(item);
  if (!valid && validator.errors) {
    for (const error of validator.errors) {
      const location = error.instancePath || "/";
      errors.push(`schema ${location} ${error.message ?? "is invalid"}`);
    }
  }

  if (record.stateDir !== item.state) {
    errors.push(`path state '${record.stateDir}' does not match item.state '${item.state}'`);
  }

  if (record.truthClassDir !== item.truth_class) {
    errors.push(
      `path truth class '${record.truthClassDir}' does not match item.truth_class '${item.truth_class}'`
    );
  }

  return errors;
}

export function validateMemoryCorpus(records: LoadedMemoryRecord[]): string[] {
  const errors: string[] = [];
  const recordsById = new Map<string, LoadedMemoryRecord>();
  const duplicateIds = new Map<string, string[]>();

  for (const record of records) {
    const existing = recordsById.get(record.item.id);
    if (existing) {
      duplicateIds.set(record.item.id, [existing.filePath, ...(duplicateIds.get(record.item.id) ?? []), record.filePath]);
    } else {
      recordsById.set(record.item.id, record);
    }
  }

  for (const [id, filePaths] of duplicateIds.entries()) {
    const uniquePaths = [...new Set(filePaths)].sort((a, b) => a.localeCompare(b));
    errors.push(`duplicate id '${id}' present in ${uniquePaths.join(", ")}`);
  }

  for (const record of records) {
    const { item } = record;

    if (item.status === "superseded" && item.state !== "suppressed") {
      errors.push(`${record.filePath}: superseded records must be in suppressed state`);
    }

    if (item.status === "superseded" && !item.superseded_by) {
      errors.push(`${record.filePath}: superseded records must set superseded_by`);
    }

    if (item.state === "active" && item.status === "superseded") {
      errors.push(`${record.filePath}: active records cannot have superseded status`);
    }

    if (item.state === "active" && item.superseded_by) {
      errors.push(`${record.filePath}: active records cannot reference superseded_by`);
    }

    if (item.superseded_by) {
      const successor = recordsById.get(item.superseded_by);
      if (!successor) {
        errors.push(`${record.filePath}: superseded_by references missing record '${item.superseded_by}'`);
      } else if (!(successor.item.supersedes ?? []).includes(item.id)) {
        errors.push(`${record.filePath}: superseded_by '${item.superseded_by}' does not reciprocally list '${item.id}' in supersedes`);
      }
    }

    for (const supersededId of item.supersedes ?? []) {
      const prior = recordsById.get(supersededId);
      if (!prior) {
        errors.push(`${record.filePath}: supersedes references missing record '${supersededId}'`);
      }
    }
  }

  return errors;
}

export function isMemoryState(value: string): value is MemoryState {
  return value === "active" || value === "durable" || value === "suppressed";
}

export function isMemoryTruthClass(value: string): value is MemoryTruthClass {
  return ["preference", "environment", "project", "operational", "relationship", "policy", "decision"].includes(value);
}
