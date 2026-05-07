import { loadMemoryRecords } from "../load/loadMemoryRecords.js";
import type { MemoryItem } from "../types/MemoryItem.js";
import type { QmdMemoryHit } from "./mapQmdResults.js";

export interface CanonicalQmdMemoryHit {
  qmd: QmdMemoryHit;
  record: MemoryItem;
}

export interface ResolveQmdHitsResult {
  resolved: CanonicalQmdMemoryHit[];
  missing_memory_ids: string[];
}

export async function resolveQmdHits(
  memoryRoot: string,
  hits: QmdMemoryHit[]
): Promise<ResolveQmdHitsResult> {
  const { records, errors } = await loadMemoryRecords(memoryRoot);
  if (errors.length > 0) {
    throw new Error(`failed to load canonical memory records: ${errors.join("; ")}`);
  }

  const byId = new Map(records.map((record) => [record.item.id, record.item] as const));
  const resolved: CanonicalQmdMemoryHit[] = [];
  const missing: string[] = [];

  for (const hit of hits) {
    const record = byId.get(hit.memory_id);
    if (!record) {
      missing.push(hit.memory_id);
      continue;
    }
    resolved.push({ qmd: hit, record });
  }

  return {
    resolved,
    missing_memory_ids: missing
  };
}
