import { mkdir } from "node:fs/promises";
import type { QmdSdkStore } from "./createQmdStore.js";
import { createQmdMemoryStore } from "./createQmdStore.js";
import { getQmdMemoryPaths, type QmdMemoryPaths } from "./paths.js";

export interface QmdBootstrapOptions {
  embed?: boolean;
  forceEmbed?: boolean;
  chunkStrategy?: "regex" | "auto";
}

export interface QmdUpdateResult {
  collections: number;
  indexed: number;
  updated: number;
  unchanged: number;
  removed: number;
  needsEmbedding: number;
}

export interface QmdEmbedResult {
  docsProcessed: number;
  chunksEmbedded: number;
  errors: string[];
  durationMs: number;
}

export interface QmdBootstrapResult {
  paths: QmdMemoryPaths;
  updated: QmdUpdateResult;
  embedded: QmdEmbedResult | null;
}

interface QmdBootstrapStore extends QmdSdkStore {
  update(options?: {
    collections?: string[];
    onProgress?: (progress: { collection: string; file: string; current: number; total: number }) => void;
  }): Promise<QmdUpdateResult>;
  embed?(options?: {
    force?: boolean;
    chunkStrategy?: "regex" | "auto";
    onProgress?: (progress: { current: number; total: number; collection?: string }) => void;
  }): Promise<QmdEmbedResult>;
}

export async function bootstrapQmdMemoryIndex(
  options: QmdBootstrapOptions = {},
  dependencies: {
    paths?: QmdMemoryPaths;
    createStore?: (paths: QmdMemoryPaths) => Promise<QmdBootstrapStore>;
  } = {}
): Promise<QmdBootstrapResult> {
  const paths = dependencies.paths ?? getQmdMemoryPaths();
  const createStore = dependencies.createStore ?? (createQmdMemoryStore as (paths: QmdMemoryPaths) => Promise<QmdBootstrapStore>);

  await mkdir(paths.exportRoot, { recursive: true });
  await mkdir(paths.configRoot, { recursive: true });
  await mkdir(paths.indexRoot, { recursive: true });

  const store = await createStore(paths);
  try {
    const updated = await store.update();
    const embedded = options.embed
      ? await (() => {
          if (typeof store.embed !== "function") {
            throw new Error("QMD store does not expose embed().");
          }
          return store.embed({
            force: options.forceEmbed ?? false,
            chunkStrategy: options.chunkStrategy ?? "regex"
          });
        })()
      : null;

    return {
      paths,
      updated,
      embedded
    };
  } finally {
    await store.close();
  }
}
