import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import type { LoadMemoryRecordsResult, LoadedMemoryRecord, MemoryItem } from "../types/MemoryItem.js";

export async function loadMemoryRecords(root: string): Promise<LoadMemoryRecordsResult> {
  const records: LoadedMemoryRecord[] = [];
  const errors: string[] = [];
  const states = ["active", "durable", "suppressed"] as const;

  for (const state of states) {
    const stateDir = path.join(root, state);
    let truthClasses: string[] = [];
    try {
      truthClasses = await readdir(stateDir);
    } catch {
      continue;
    }

    for (const truthClass of truthClasses.sort((a, b) => a.localeCompare(b))) {
      const truthDir = path.join(stateDir, truthClass);
      let entries: string[] = [];
      try {
        entries = await readdir(truthDir);
      } catch {
        continue;
      }

      for (const entry of entries.sort((a, b) => a.localeCompare(b))) {
        if (!entry.endsWith(".json")) continue;

        const filePath = path.join(truthDir, entry);

        try {
          const raw = await readFile(filePath, "utf8");
          records.push({
            item: JSON.parse(raw) as MemoryItem,
            filePath,
            stateDir: state,
            truthClassDir: truthClass
          });
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          errors.push(`${filePath}: ${message}`);
        }
      }
    }
  }

  return { records, errors };
}
