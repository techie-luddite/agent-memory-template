import { access } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { buildQmdMemoryConfig, type QmdMemoryConfig } from "./config.js";
import { getQmdMemoryPaths, type QmdMemoryPaths } from "./paths.js";

export interface QmdSdkStore {
  dbPath: string;
  close(): Promise<void> | void;
}

interface QmdSdkModule {
  createStore(options: { dbPath: string; config: QmdMemoryConfig }): Promise<QmdSdkStore>;
}

async function loadQmdSdkModule(paths: QmdMemoryPaths): Promise<QmdSdkModule> {
  try {
    await access(paths.runtimeDistEntry);
  } catch {
    throw new Error(
      [
        `QMD runtime is not built or not available at '${paths.runtimeDistEntry}'.`,
        `Expected Agent Memory Template-owned runtime root: '${paths.runtimeRoot}'.`,
        "Build/install the Agent Memory Template-owned runtime before using the SDK adapter.",
        "Do not use the upstream reference checkout as runtime."
      ].join(" ")
    );
  }

  const imported = await import(pathToFileURL(paths.runtimeDistEntry).href) as Partial<QmdSdkModule>;
  if (typeof imported.createStore !== "function") {
    throw new Error(`QMD runtime module '${paths.runtimeDistEntry}' does not export createStore().`);
  }

  return imported as QmdSdkModule;
}

export async function createQmdMemoryStore(paths: QmdMemoryPaths = getQmdMemoryPaths()): Promise<QmdSdkStore> {
  const qmd = await loadQmdSdkModule(paths);
  return qmd.createStore({
    dbPath: paths.dbPath,
    config: buildQmdMemoryConfig(paths)
  });
}
