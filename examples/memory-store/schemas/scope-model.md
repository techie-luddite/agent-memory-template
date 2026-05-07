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

## Universal vs scoped truth

- Use `global` for truths intended to apply across environments.
- Use `machine:<name>` for machine-specific environment facts.
- Use `workspace:<path>` or `repo:<name>` for project-specific facts.
- Do not mark a memory global merely because it is currently true in one environment.

## Rules

- Prefer narrower, confirmed scope over broader generic scope.
- Environment and operational memories should usually carry explicit scope.
- A memory with the wrong scope should be suppressed or superseded rather than left ambiguous.
- Scope is part of retrieval ranking, not just metadata.
