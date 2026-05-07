import { getMemoryRoot } from "../util/paths.js";
import type { MemoryItem } from "../types/MemoryItem.js";
import { buildDefaultQmdQuery } from "./defaultRouting.js";
import { retrieveMemoryWithQmd, type RetrieveMemoryWithQmdResult } from "./retrieveMemoryWithQmd.js";
import type { SearchQmdMemoryQuery } from "./searchQmdMemory.js";

export interface RetrieveWithDefaultQmdRoutingOptions {
  prompt: string;
  memoryRoot?: string;
  deterministicRecords?: MemoryItem[];
  overrideQmd?: Partial<SearchQmdMemoryQuery>;
}

export async function retrieveWithDefaultQmdRouting(
  options: RetrieveWithDefaultQmdRoutingOptions,
  dependencies?: Parameters<typeof retrieveMemoryWithQmd>[1]
): Promise<RetrieveMemoryWithQmdResult & { qmd_query: SearchQmdMemoryQuery }> {
  const qmdQuery: SearchQmdMemoryQuery = {
    ...buildDefaultQmdQuery({ prompt: options.prompt }),
    ...(options.overrideQmd ?? {})
  };

  const subjectBias = qmdQuery.collections?.includes("memory-active")
    && qmdQuery.intent?.includes("current active operational focus")
    ? ["current-focus"]
    : undefined;

  const result = await retrieveMemoryWithQmd(
    {
      memoryRoot: options.memoryRoot ?? getMemoryRoot(),
      deterministicRecords: options.deterministicRecords,
      subjectBias,
      qmd: qmdQuery
    },
    dependencies
  );

  return {
    ...result,
    qmd_query: qmdQuery
  };
}
