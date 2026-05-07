# Scope Model

Scope determines where a memory is valid and how it should be prioritized.

## Example scope forms

- `user:local-user`
- `machine:workstation`
- `workspace:/home/example/.agent-memory`
- `workspace:/home/example/dev/agent`
- `repo:agent-memory`
- `repo:agent-agents`
- `global`

## Rules

- Prefer narrower, confirmed scope over broader generic scope.
- Environment and operational memories should usually carry explicit scope.
- A memory with the wrong scope should be suppressed or superseded rather than left ambiguous.
- Scope is part of retrieval ranking, not just metadata.
