function normalizeScope(scope: string): string {
  return scope.trim();
}

function isWorkspaceScope(scope: string): boolean {
  return scope.startsWith("workspace:");
}

function workspacePath(scope: string): string {
  return scope.slice("workspace:".length);
}

function isWorkspaceHierarchyMatch(left: string, right: string): boolean {
  if (!isWorkspaceScope(left) || !isWorkspaceScope(right)) return false;

  const leftPath = workspacePath(left);
  const rightPath = workspacePath(right);

  return (
    leftPath === rightPath ||
    leftPath.startsWith(`${rightPath}/`) ||
    rightPath.startsWith(`${leftPath}/`)
  );
}

function pairScopeScore(memoryScope: string, requestedScope: string): number {
  const normalizedMemoryScope = normalizeScope(memoryScope);
  const normalizedRequestedScope = normalizeScope(requestedScope);

  if (!normalizedMemoryScope || !normalizedRequestedScope) return 0;
  if (normalizedMemoryScope === normalizedRequestedScope) return 3;
  if (normalizedMemoryScope === "global") return 1;
  if (isWorkspaceHierarchyMatch(normalizedMemoryScope, normalizedRequestedScope)) return 2;
  return 0;
}

export function calculateScopeScore(memoryScopes: string[], requestedScopes: string[]): number {
  if (requestedScopes.length === 0) return 0;

  let score = 0;
  for (const memoryScope of memoryScopes) {
    for (const requestedScope of requestedScopes) {
      score = Math.max(score, pairScopeScore(memoryScope, requestedScope));
    }
  }

  return score;
}

export function matchScopes(memoryScopes: string[], requestedScopes: string[]): boolean {
  return calculateScopeScore(memoryScopes, requestedScopes) > 0;
}
