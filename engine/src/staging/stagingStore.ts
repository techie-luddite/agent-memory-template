import { mkdir, readdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";

export type StagingKind = "events" | "candidates";

export interface StagedWriteResult {
  filePath: string;
}

export interface StagedRecord<T = unknown> {
  id: string;
  filePath: string;
  payload: T;
}

function stagingDir(memoryRoot: string, kind: StagingKind): string {
  return path.join(memoryRoot, "staging", kind);
}

async function atomicWriteJson(filePath: string, payload: unknown): Promise<void> {
  const dir = path.dirname(filePath);
  const tempPath = path.join(dir, `.${path.basename(filePath)}.tmp-${process.pid}-${Date.now()}`);
  await writeFile(tempPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  await rename(tempPath, filePath);
}

export async function writeStagedRecord(
  memoryRoot: string,
  kind: StagingKind,
  id: string,
  payload: unknown
): Promise<StagedWriteResult> {
  const dir = stagingDir(memoryRoot, kind);
  const filePath = path.join(dir, `${id}.json`);

  await mkdir(dir, { recursive: true });
  await atomicWriteJson(filePath, payload);

  return { filePath };
}

export async function listStagedRecords<T = unknown>(memoryRoot: string, kind: StagingKind): Promise<StagedRecord<T>[]> {
  const dir = stagingDir(memoryRoot, kind);
  let entries: string[] = [];

  try {
    entries = await readdir(dir);
  } catch {
    return [];
  }

  const records: StagedRecord<T>[] = [];
  for (const entry of entries.filter((name) => name.endsWith(".json")).sort((a, b) => a.localeCompare(b))) {
    const filePath = path.join(dir, entry);
    const payload = JSON.parse(await readFile(filePath, "utf8")) as T;
    const id = entry.replace(/\.json$/, "");
    records.push({ id, filePath, payload });
  }

  return records;
}

export async function readStagedRecord<T = unknown>(memoryRoot: string, kind: StagingKind, id: string): Promise<StagedRecord<T>> {
  const filePath = path.join(stagingDir(memoryRoot, kind), `${id}.json`);
  const payload = JSON.parse(await readFile(filePath, "utf8")) as T;
  return { id, filePath, payload };
}

export async function deleteStagedRecord(memoryRoot: string, kind: StagingKind, id: string): Promise<void> {
  const filePath = path.join(stagingDir(memoryRoot, kind), `${id}.json`);
  await rm(filePath, { force: true });
}
