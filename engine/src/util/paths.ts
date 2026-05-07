import os from "node:os";
import path from "node:path";

export function getMemoryRoot(): string {
  return process.env.MEMORY_ROOT ?? path.join(os.homedir(), ".agent-memory", "memory");
}
