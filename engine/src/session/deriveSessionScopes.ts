/**
 * Derives retrieval scopes for a session from a workspace path.
 *
 * Standard scope forms:
 *   workspace:/absolute/path
 *   global
 *
 * Rules:
 * - The workspace path always produces a workspace scope.
 * - Ancestor workspace paths are included up to a depth limit for hierarchy matching.
 * - `global` is always appended as a fallback.
 */

import path from "node:path";

export interface SessionScopeOptions {
  workspace: string | null;
  extraScopes?: string[];
  ancestorDepth?: number;
}

export function deriveSessionScopes(options: SessionScopeOptions): string[] {
  const { workspace, extraScopes = [], ancestorDepth = 2 } = options;
  const scopes = new Set<string>();

  if (workspace) {
    const normalized = path.resolve(workspace);
    scopes.add(`workspace:${normalized}`);

    // Include ancestor workspaces up to depth for hierarchy matching
    let current = normalized;
    for (let i = 0; i < ancestorDepth; i++) {
      const parent = path.dirname(current);
      if (parent === current) break;
      scopes.add(`workspace:${parent}`);
      current = parent;
    }
  }

  for (const scope of extraScopes) {
    if (scope.trim()) scopes.add(scope.trim());
  }

  scopes.add("global");

  return [...scopes];
}
