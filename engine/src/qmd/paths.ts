import os from "node:os";
import path from "node:path";

export interface QmdMemoryPaths {
  runtimeRoot: string;
  runtimeDistEntry: string;
  runtimePackageJson: string;
  runtimeNotesPath: string;
  runtimeRootData: string;
  exportRoot: string;
  configRoot: string;
  indexRoot: string;
  dbPath: string;
  indexName: string;
}

export function getQmdMemoryPaths(): QmdMemoryPaths {
  const runtimeRoot = process.env.QMD_RUNTIME_ROOT ?? path.join(os.homedir(), ".agent-memory", "runtime", "qmd-runtime");
  const runtimeRootData = process.env.QMD_DATA_ROOT ?? path.join(os.homedir(), ".agent-memory", "runtime", "qmd-memory");
  const exportRoot = process.env.QMD_EXPORT_ROOT ?? path.join(runtimeRootData, "export");
  const configRoot = process.env.QMD_CONFIG_ROOT ?? path.join(runtimeRootData, "config");
  const indexRoot = process.env.QMD_INDEX_ROOT ?? path.join(runtimeRootData, "index");
  const indexName = process.env.QMD_INDEX_NAME ?? "agent-memory";

  return {
    runtimeRoot,
    runtimeDistEntry: path.join(runtimeRoot, "dist", "index.js"),
    runtimePackageJson: path.join(runtimeRoot, "package.json"),
    runtimeNotesPath: path.join(runtimeRoot, "RUNTIME_NOTES.md"),
    runtimeRootData,
    exportRoot,
    configRoot,
    indexRoot,
    dbPath: path.join(indexRoot, "qmd", `${indexName}.sqlite`),
    indexName
  };
}
