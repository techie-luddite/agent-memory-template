# Roadmap

Agent Memory Template is not trying to become a full agent platform or a managed memory service. Its lane is narrower:

> A portable memory governance layer for agent workflows.

The project should stay local-first, agent-neutral, explainable, and careful about truth boundaries.

## Near term

### 1. Review workflow

Add an operator-friendly review surface for staged and active memories:

```bash
agent-memory review --staged
agent-memory review --active
agent-memory review --due
```

Initial version can be terminal-only. The goal is to make promotion, suppression, editing, and deletion deliberate rather than hidden automation.

### 2. Consent and capture modes

Add config-driven capture policy:

```json
{
  "capture_mode": "manual | suggest | auto-stage",
  "promotion_mode": "manual | session-end",
  "sensitive_truth_classes": ["relationship", "preference"]
}
```

The point is not to remember everything. The point is to remember the right things with appropriate consent.

### 3. Adapter examples

Keep adapters small and optional:

```text
examples/adapters/
  generic-shell/
  claude-code/
  codex-cli/
  aider/
  letta/
```

Each adapter should show lifecycle calls, not create a new platform.

### 4. Import/export portability

Add portable formats:

```bash
agent-memory export --format jsonl
agent-memory export --format markdown
agent-memory import --format jsonl
```

Memory should not be trapped in one runtime.

### 5. Stronger scoped-truth tooling

Make truth boundaries inspectable:

```bash
agent-memory scopes explain --workspace "$PWD"
agent-memory scopes list
```

This reinforces the distinction between global, user, machine, workspace, repo, and operational truth.

## Later

- optional TUI review mode
- schema versioning and migrations
- richer subject ontology tooling
- stale/supersession repair helpers
- more prompt packet formats
- optional MCP server wrapper
- optional retrieval backend adapters

## Non-goals

- becoming a hosted memory platform
- replacing full agent runtimes
- storing raw transcripts as memory
- automatic always-on personalization without review
- collapsing general knowledge, project docs, and personal continuity into one undifferentiated store
