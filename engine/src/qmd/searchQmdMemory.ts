import type { QmdSdkStore } from "./createQmdStore.js";
import { createQmdMemoryStore } from "./createQmdStore.js";
import { getQmdMemoryPaths, type QmdMemoryPaths } from "./paths.js";
import { mapQmdResults, type QmdDocumentLikeResult, type QmdMemoryHit } from "./mapQmdResults.js";

export interface SearchQmdMemoryQuery {
  query: string;
  intent?: string;
  mode?: "lex" | "vector" | "hybrid";
  collections?: Array<"memory-active" | "memory-durable" | "memory-policy" | "memory-suppressed">;
  limit?: number;
  minScore?: number;
  rerank?: boolean;
  chunkStrategy?: "regex" | "auto";
  explain?: boolean;
}

interface SearchableQmdStore extends QmdSdkStore {
  searchLex(query: string, options?: { limit?: number; collection?: string }): Promise<QmdDocumentLikeResult[]>;
  searchVector(query: string, options?: { limit?: number; collection?: string }): Promise<QmdDocumentLikeResult[]>;
  search(options: {
    query?: string;
    intent?: string;
    rerank?: boolean;
    collections?: string[];
    limit?: number;
    minScore?: number;
    explain?: boolean;
    chunkStrategy?: "regex" | "auto";
  }): Promise<QmdDocumentLikeResult[]>;
}

function supportedCollections(input?: SearchQmdMemoryQuery["collections"]): string[] | undefined {
  if (!input || input.length === 0) return undefined;
  return [...new Set(input)];
}

export async function searchQmdMemory(
  request: SearchQmdMemoryQuery,
  dependencies: {
    paths?: QmdMemoryPaths;
    createStore?: (paths: QmdMemoryPaths) => Promise<SearchableQmdStore>;
  } = {}
): Promise<{ paths: QmdMemoryPaths; hits: QmdMemoryHit[] }> {
  const paths = dependencies.paths ?? getQmdMemoryPaths();
  const createStore = dependencies.createStore ?? (createQmdMemoryStore as (paths: QmdMemoryPaths) => Promise<SearchableQmdStore>);
  const mode = request.mode ?? "hybrid";
  const collections = supportedCollections(request.collections);
  const store = await createStore(paths);

  try {
    let results: QmdDocumentLikeResult[] = [];

    if (mode === "lex") {
      if (collections && collections.length > 1) {
        const batches = await Promise.all(
          collections.map((collection) => store.searchLex(request.query, { limit: request.limit, collection }))
        );
        results = batches.flat();
      } else {
        results = await store.searchLex(request.query, {
          limit: request.limit,
          collection: collections?.[0]
        });
      }
    } else if (mode === "vector") {
      if (collections && collections.length > 1) {
        const batches = await Promise.all(
          collections.map((collection) => store.searchVector(request.query, { limit: request.limit, collection }))
        );
        results = batches.flat();
      } else {
        results = await store.searchVector(request.query, {
          limit: request.limit,
          collection: collections?.[0]
        });
      }
    } else {
      results = await store.search({
        query: request.query,
        intent: request.intent,
        rerank: request.rerank,
        collections,
        limit: request.limit,
        minScore: request.minScore,
        explain: request.explain,
        chunkStrategy: request.chunkStrategy
      });
    }

    const hits = mapQmdResults(results)
      .sort((a, b) => b.score - a.score)
      .slice(0, request.limit ?? results.length);

    return { paths, hits };
  } finally {
    await store.close();
  }
}
