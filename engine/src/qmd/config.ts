import path from "node:path";
import type { QmdMemoryPaths } from "./paths.js";

export interface QmdCollectionConfig {
  path: string;
  pattern: string;
  includeByDefault?: boolean;
  context?: Record<string, string>;
}

export interface QmdMemoryConfig {
  global_context: string;
  collections: Record<string, QmdCollectionConfig>;
}

export function buildQmdMemoryConfig(paths: QmdMemoryPaths): QmdMemoryConfig {
  return {
    global_context:
      "Agent Memory Template memory retrieval index. Results are derived from canonical memory records and must be mapped back to canonical memory IDs before use.",
    collections: {
      "memory-active": {
        path: path.join(paths.exportRoot, "memory-active"),
        pattern: "**/*.md",
        context: {
          "/": "Live continuity-bearing operational memory for current focus, blockers, and active work state."
        }
      },
      "memory-durable": {
        path: path.join(paths.exportRoot, "memory-durable"),
        pattern: "**/*.md",
        context: {
          "/": "Stable continuity-bearing memory including decisions, preferences, environment facts, and durable project truths."
        }
      },
      "memory-policy": {
        path: path.join(paths.exportRoot, "memory-policy"),
        pattern: "**/*.md",
        context: {
          "/": "Normative rules, operating expectations, and non-negotiable workflow constraints for this environment."
        }
      }
    }
  };
}
