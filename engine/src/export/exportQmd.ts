import { mkdir, readdir, rm, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import type { LoadedMemoryRecord, MemoryItem } from "../types/MemoryItem.js";

export interface ExportQmdOptions {
  outputRoot: string;
  includeSuppressed?: boolean;
  dryRun?: boolean;
}

export interface ExportQmdResult {
  output_root: string;
  dry_run: boolean;
  include_suppressed: boolean;
  exported: number;
  removed: number;
  manifest: string;
  collections: Record<string, number>;
  files: Array<{
    memory_id: string;
    collection: string;
    relative_path: string;
  }>;
  removed_files: string[];
}

function exportCollectionFor(record: MemoryItem): string | null {
  if (record.state === "suppressed") {
    return "memory-suppressed";
  }

  if (record.truth_class === "policy") {
    return "memory-policy";
  }

  if (record.state === "active") {
    return "memory-active";
  }

  if (record.state === "durable") {
    return "memory-durable";
  }

  return null;
}

function yamlScalar(value: string | number | boolean | null): string {
  if (value === null) return "null";
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return JSON.stringify(value);
}

function yamlList(values: string[]): string[] {
  if (values.length === 0) return ["[]"];
  return values.map((value) => `  - ${yamlScalar(value)}`);
}

function titleFor(record: MemoryItem): string {
  return record.summary.trim() || record.id;
}

function retrievalHintsFor(record: MemoryItem): string[] {
  const hints = new Set<string>();
  const subject = (record.subject ?? "").trim().toLowerCase();

  if (subject === "current-focus") {
    hints.add("current focus");
    hints.add("what we are focused on");
    hints.add("what are we focused on");
    hints.add("what we are working on");
    hints.add("what were we working on");
    hints.add("what we were working on");
    hints.add("current work");
    hints.add("current task");
    hints.add("active work item");
    hints.add("present task");
    hints.add("recent work");
  }

  if (subject === "blocker") {
    hints.add("current blocker");
    hints.add("what is blocking us");
    hints.add("what are we blocked on");
  }

  if (record.truth_class === "policy") {
    hints.add("operating rule");
    hints.add("policy");
    hints.add("constraint");
    hints.add("how this should work");
  }

  if (record.truth_class === "decision") {
    hints.add("decision");
    hints.add("what we decided");
    hints.add("chosen approach");
  }

  if (record.truth_class === "preference") {
    hints.add("preference");
    hints.add("how the user prefers to work");
  }

  if (record.truth_class === "environment") {
    hints.add("environment fact");
    hints.add("machine or shell context");
  }

  if (record.truth_class === "project") {
    hints.add("project structure");
    hints.add("workspace truth");
  }

  for (const tag of record.tags) {
    hints.add(tag);
  }

  return [...hints];
}

function renderQmdDocument(record: MemoryItem): string {
  const lines = [
    "---",
    `kind: ${yamlScalar("agent-memory")}`,
    `memory_id: ${yamlScalar(record.id)}`,
    `state: ${yamlScalar(record.state)}`,
    `truth_class: ${yamlScalar(record.truth_class)}`,
    `subject: ${yamlScalar(record.subject ?? null)}`,
    `status: ${yamlScalar(record.status)}`,
    "scope:",
    ...yamlList(record.scope),
    `importance: ${yamlScalar(record.importance)}`,
    `confidence: ${yamlScalar(record.confidence)}`,
    `retrieval_weight: ${yamlScalar(record.retrieval_weight)}`,
    `created_at: ${yamlScalar(record.created_at)}`,
    `updated_at: ${yamlScalar(record.updated_at)}`,
    `last_reinforced_at: ${yamlScalar(record.last_reinforced_at ?? null)}`,
    `last_reinforced_in_session: ${yamlScalar(record.last_reinforced_in_session ?? null)}`,
    `reinforcement_count: ${yamlScalar(record.reinforcement_count ?? 0)}`,
    `activity_state: ${yamlScalar(record.activity_state ?? null)}`,
    `review_after_sessions: ${yamlScalar(record.review_after_sessions ?? null)}`,
    `review_after_interactions: ${yamlScalar(record.review_after_interactions ?? null)}`,
    "supersedes:",
    ...yamlList(record.supersedes ?? []),
    `superseded_by: ${yamlScalar(record.superseded_by ?? null)}`,
    "tags:",
    ...yamlList(record.tags),
    "---",
    "",
    `# ${titleFor(record)}`,
    "",
    "## Summary",
    record.summary,
    "",
    "## Assertion",
    record.assertion,
    "",
    "## Subject",
    record.subject ?? "unknown",
    "",
    "## Truth class",
    record.truth_class,
    "",
    "## State",
    record.state,
    "",
    "## Status",
    record.status,
    "",
    "## Scope",
    ...(record.scope.length > 0 ? record.scope.map((scope) => `- ${scope}`) : ["- none"]),
    "",
    "## Retrieval hints",
    ...retrievalHintsFor(record).map((hint) => `- ${hint}`),
    "",
    "## Provenance",
    `- canonical memory id: ${record.id}`,
    `- truth class: ${record.truth_class}`,
    `- state: ${record.state}`,
    ""
  ];

  return lines.join("\n");
}

async function listFilesRecursive(root: string): Promise<string[]> {
  const entries = await readdir(root, { withFileTypes: true });
  const results: string[] = [];

  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    const entryPath = path.join(root, entry.name);
    if (entry.isDirectory()) {
      results.push(...(await listFilesRecursive(entryPath)));
      continue;
    }
    results.push(entryPath);
  }

  return results;
}

function manifestPath(outputRoot: string): string {
  return path.join(outputRoot, "manifest.json");
}

export async function exportQmd(records: LoadedMemoryRecord[], options: ExportQmdOptions): Promise<ExportQmdResult> {
  const outputRoot = options.outputRoot;
  const includeSuppressed = options.includeSuppressed ?? false;
  const dryRun = options.dryRun ?? false;

  const candidates = records.filter((record) => includeSuppressed || record.item.state !== "suppressed");
  const files = candidates
    .map((record) => {
      const collection = exportCollectionFor(record.item);
      if (!collection) return null;
      const relativePath = path.join(collection, record.item.truth_class, `${record.item.id}.md`);
      return {
        record,
        collection,
        relativePath,
        absolutePath: path.join(outputRoot, relativePath)
      };
    })
    .filter((entry): entry is NonNullable<typeof entry> => Boolean(entry))
    .sort((a, b) => a.relativePath.localeCompare(b.relativePath));

  const desiredPaths = new Set(files.map((file) => file.absolutePath));
  const existingPaths = await (async () => {
    try {
      return await listFilesRecursive(outputRoot);
    } catch {
      return [] as string[];
    }
  })();

  const removable = existingPaths.filter((filePath) => {
    if (filePath === manifestPath(outputRoot)) return true;
    return filePath.endsWith(".md") && !desiredPaths.has(filePath);
  }).sort((a, b) => a.localeCompare(b));

  const result: ExportQmdResult = {
    output_root: outputRoot,
    dry_run: dryRun,
    include_suppressed: includeSuppressed,
    exported: files.length,
    removed: removable.length,
    manifest: manifestPath(outputRoot),
    collections: files.reduce<Record<string, number>>((acc, file) => {
      acc[file.collection] = (acc[file.collection] ?? 0) + 1;
      return acc;
    }, {}),
    files: files.map((file) => ({
      memory_id: file.record.item.id,
      collection: file.collection,
      relative_path: file.relativePath
    })),
    removed_files: removable.map((filePath) => path.relative(outputRoot, filePath) || path.basename(filePath))
  };

  if (dryRun) {
    return result;
  }

  await mkdir(outputRoot, { recursive: true });

  for (const staleFile of removable) {
    await unlink(staleFile);
  }

  for (const file of files) {
    await mkdir(path.dirname(file.absolutePath), { recursive: true });
    await writeFile(file.absolutePath, renderQmdDocument(file.record.item), "utf8");
  }

  await writeFile(result.manifest, `${JSON.stringify({
    generated_at: new Date().toISOString(),
    exported: result.exported,
    collections: result.collections,
    files: result.files
  }, null, 2)}\n`, "utf8");

  const knownCollections = ["memory-active", "memory-durable", "memory-policy", "memory-suppressed"];
  for (const collection of knownCollections) {
    const collectionPath = path.join(outputRoot, collection);
    if (!files.some((file) => file.collection === collection)) {
      await rm(collectionPath, { recursive: true, force: true });
    }
  }

  return result;
}
