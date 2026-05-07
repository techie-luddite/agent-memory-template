import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { LoadedMemoryRecord, MemoryState } from "../types/MemoryItem.js";

interface ManifestItem {
  id: string;
  truth_class: string;
  summary: string;
  subject: string | null;
  scope: string[];
  retrieval_weight: number;
  status: string;
  file: string;
}

interface StateManifest {
  state: MemoryState;
  description: string;
  generated_at: string;
  item_count: number;
  items: ManifestItem[];
}

interface ByScopeIndex {
  description: string;
  generated_at: string;
  scopes: Record<string, string[]>;
}

interface BySubjectIndex {
  description: string;
  generated_at: string;
  subjects: Record<string, string[]>;
}

interface ByTruthClassIndex {
  description: string;
  generated_at: string;
  truth_classes: Record<string, string[]>;
}

function relativeFilePath(memoryRoot: string, filePath: string): string {
  return path.relative(memoryRoot, filePath);
}

function buildManifestItem(memoryRoot: string, record: LoadedMemoryRecord): ManifestItem {
  return {
    id: record.item.id,
    truth_class: record.item.truth_class,
    summary: record.item.summary,
    subject: record.item.subject ?? null,
    scope: record.item.scope,
    retrieval_weight: record.item.retrieval_weight,
    status: record.item.status,
    file: relativeFilePath(memoryRoot, record.filePath)
  };
}

function descriptionForState(state: MemoryState): string {
  switch (state) {
    case "active":
      return "Manifest of active memory records eligible for default retrieval.";
    case "durable":
      return "Manifest of durable memory records eligible for retrieval after active memory.";
    case "suppressed":
      return "Manifest of suppressed memory records excluded from default retrieval.";
  }
}

function sortedUnique(values: string[]): string[] {
  return [...new Set(values)].sort((a, b) => a.localeCompare(b));
}

function sortManifestItems(items: ManifestItem[]): ManifestItem[] {
  return [...items].sort((a, b) => {
    if (b.retrieval_weight !== a.retrieval_weight) {
      return b.retrieval_weight - a.retrieval_weight;
    }
    return a.id.localeCompare(b.id);
  });
}

function sortRecordGroups(groups: Record<string, string[]>): Record<string, string[]> {
  return Object.fromEntries(
    Object.entries(groups)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, ids]) => [key, sortedUnique(ids)])
  );
}

export async function rebuildIndexes(memoryRoot: string, records: LoadedMemoryRecord[]): Promise<void> {
  const indexesDir = path.join(memoryRoot, "indexes");
  await mkdir(indexesDir, { recursive: true });

  const generatedAt = new Date().toISOString();
  const manifestsByState: Record<MemoryState, ManifestItem[]> = {
    active: [],
    durable: [],
    suppressed: []
  };
  const byScope: Record<string, string[]> = {};
  const bySubject: Record<string, string[]> = {};
  const byTruthClass: Record<string, string[]> = {};

  for (const record of records) {
    manifestsByState[record.item.state].push(buildManifestItem(memoryRoot, record));

    for (const scope of record.item.scope) {
      byScope[scope] ??= [];
      byScope[scope].push(record.item.id);
    }

    if (record.item.subject) {
      bySubject[record.item.subject] ??= [];
      bySubject[record.item.subject].push(record.item.id);
    }

    byTruthClass[record.item.truth_class] ??= [];
    byTruthClass[record.item.truth_class].push(record.item.id);
  }

  const activeManifest: StateManifest = {
    state: "active",
    description: descriptionForState("active"),
    generated_at: generatedAt,
    item_count: manifestsByState.active.length,
    items: sortManifestItems(manifestsByState.active)
  };

  const durableManifest: StateManifest = {
    state: "durable",
    description: descriptionForState("durable"),
    generated_at: generatedAt,
    item_count: manifestsByState.durable.length,
    items: sortManifestItems(manifestsByState.durable)
  };

  const suppressedManifest: StateManifest = {
    state: "suppressed",
    description: descriptionForState("suppressed"),
    generated_at: generatedAt,
    item_count: manifestsByState.suppressed.length,
    items: sortManifestItems(manifestsByState.suppressed)
  };

  const byScopeIndex: ByScopeIndex = {
    description: "Lookup index from scope to memory item ids.",
    generated_at: generatedAt,
    scopes: sortRecordGroups(byScope)
  };

  const bySubjectIndex: BySubjectIndex = {
    description: "Lookup index from subject to memory item ids.",
    generated_at: generatedAt,
    subjects: sortRecordGroups(bySubject)
  };

  const byTruthClassIndex: ByTruthClassIndex = {
    description: "Lookup index from truth class to memory item ids.",
    generated_at: generatedAt,
    truth_classes: sortRecordGroups(byTruthClass)
  };

  await Promise.all([
    writeFile(path.join(indexesDir, "active-manifest.json"), `${JSON.stringify(activeManifest, null, 2)}\n`, "utf8"),
    writeFile(path.join(indexesDir, "durable-manifest.json"), `${JSON.stringify(durableManifest, null, 2)}\n`, "utf8"),
    writeFile(path.join(indexesDir, "suppressed-manifest.json"), `${JSON.stringify(suppressedManifest, null, 2)}\n`, "utf8"),
    writeFile(path.join(indexesDir, "by-scope.json"), `${JSON.stringify(byScopeIndex, null, 2)}\n`, "utf8"),
    writeFile(path.join(indexesDir, "by-subject.json"), `${JSON.stringify(bySubjectIndex, null, 2)}\n`, "utf8"),
    writeFile(path.join(indexesDir, "by-truth-class.json"), `${JSON.stringify(byTruthClassIndex, null, 2)}\n`, "utf8")
  ]);
}
