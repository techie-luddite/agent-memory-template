import { buildRetrievalSet } from "../retrieval/buildRetrievalSet.js";
import type { MemoryItem } from "../types/MemoryItem.js";
import { getMemoryRoot } from "../util/paths.js";
import { resolveQmdHits, type CanonicalQmdMemoryHit } from "./resolveQmdHits.js";
import { searchQmdMemory, type SearchQmdMemoryQuery } from "./searchQmdMemory.js";

export interface RetrieveMemoryWithQmdOptions {
  memoryRoot?: string;
  deterministicRecords?: MemoryItem[];
  subjectBias?: string[];
  qmd: SearchQmdMemoryQuery;
}

export interface RetrieveMemoryWithQmdResult {
  deterministic: MemoryItem[];
  qmd_resolved: CanonicalQmdMemoryHit[];
  missing_memory_ids: string[];
}

function rankDeterministic(records: MemoryItem[], query: string): MemoryItem[] {
  const retrieval = buildRetrievalSet(records, {
    query,
    limit: 8,
    activeLimit: 8,
    durableLimit: 0,
    policyLimit: 0,
    requestedScopes: []
  });
  return retrieval.active;
}

export async function retrieveMemoryWithQmd(
  options: RetrieveMemoryWithQmdOptions,
  dependencies: {
    search?: typeof searchQmdMemory;
    resolve?: typeof resolveQmdHits;
  } = {}
): Promise<RetrieveMemoryWithQmdResult> {
  const search = dependencies.search ?? searchQmdMemory;
  const resolve = dependencies.resolve ?? resolveQmdHits;
  const memoryRoot = options.memoryRoot ?? getMemoryRoot();

  const deterministicPool = options.deterministicRecords ?? [];
  const deterministic = rankDeterministic(deterministicPool, options.qmd.query)
    .filter((record) => !options.subjectBias || options.subjectBias.length === 0 || options.subjectBias.includes(record.subject ?? ""));

  const qmd = await search(options.qmd);
  const resolved = await resolve(memoryRoot, qmd.hits);

  return {
    deterministic,
    qmd_resolved: resolved.resolved,
    missing_memory_ids: resolved.missing_memory_ids
  };
}
