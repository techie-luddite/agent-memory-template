import path from "node:path";

export interface QmdDocumentLikeResult {
  filepath?: string;
  displayPath?: string;
  title?: string;
  context?: string | null;
  score?: number;
  explain?: unknown;
  snippet?: string | null;
  body?: string;
}

export interface QmdMemoryHit {
  memory_id: string;
  collection: string;
  score: number;
  displayPath: string;
  filepath: string;
  title: string;
  context: string | null;
  snippet: string | null;
  explain?: unknown;
}

function deriveCollection(filepath: string): string {
  const normalized = filepath.replace(/\\/g, "/");
  const match = normalized.match(/(?:^|\/|qmd:\/\/)(memory-active|memory-durable|memory-policy|memory-suppressed)(?:\/|$)/);
  return match?.[1] ?? "unknown";
}

export function extractMemoryId(result: QmdDocumentLikeResult): string {
  const body = result.body ?? "";
  const metadataMatch = body.match(/^memory_id:\s*"?([^"\n]+)"?$/m);
  if (metadataMatch?.[1]) return metadataMatch[1].trim();

  const sourcePath = result.filepath ?? result.displayPath ?? "";
  const pathWithoutQuery = sourcePath.split(/[?#]/, 1)[0] ?? sourcePath;
  const base = path.basename(pathWithoutQuery);
  if (base.endsWith(".md")) {
    return base.slice(0, -3);
  }

  throw new Error(`Unable to derive memory_id from QMD result path '${sourcePath}'.`);
}

export function mapQmdResult(result: QmdDocumentLikeResult): QmdMemoryHit {
  const filepath = result.filepath ?? result.displayPath ?? "";
  if (!filepath) {
    throw new Error("QMD result is missing filepath/displayPath.");
  }

  return {
    memory_id: extractMemoryId(result),
    collection: deriveCollection(filepath),
    score: result.score ?? 0,
    displayPath: result.displayPath ?? filepath,
    filepath,
    title: result.title ?? path.basename(filepath),
    context: result.context ?? null,
    snippet: result.snippet ?? null,
    explain: result.explain
  };
}

export function mapQmdResults(results: QmdDocumentLikeResult[]): QmdMemoryHit[] {
  return results.map(mapQmdResult);
}
