# Agent Integration Examples

`agent-memory` is intentionally agent-neutral. Any coding agent or harness that can run shell commands can use it.

## Minimal lifecycle

```bash
# once per machine/profile
agent-memory init

# after the user's first real prompt
agent-memory session-startup \
  --workspace "$PWD" \
  --session "$SESSION_ID" \
  --query "$USER_PROMPT"

# when something is worth preserving
agent-memory session-record \
  --type decision \
  --summary "Use reviewed memory capture rather than raw transcript storage." \
  --workspace "$PWD" \
  --session "$SESSION_ID" \
  --tags memory,lifecycle

# at session end, or before the next session starts
agent-memory session-end --session "$SESSION_ID"
```

## Agent responsibilities

The agent or wrapper decides:

- when memory is relevant
- what observations are worth recording
- whether user confirmation is required before recording
- how to inject the returned retrieval packet into its prompt/context

The memory engine handles:

- schema validation
- staging
- candidate derivation
- promotion and suppression policy
- bounded retrieval
- indexing

## Works with

This pattern can be adapted to Claude Code, Codex CLI, Gemini CLI, Aider, custom shell wrappers, editor extensions, MCP servers, or any agent runtime with command execution.
