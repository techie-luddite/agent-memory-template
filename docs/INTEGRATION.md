# Agent Memory Template — Integration Protocol

This document describes how an agent or wrapper can call the memory engine at runtime.

## Paths

Recommended separation:

| Path | Purpose |
|---|---|
| `engine/` | authored TypeScript engine source |
| `examples/memory-store/` | fake demo/test corpus |
| `~/.agent-memory/memory/` | default runtime memory store |
| `~/.agent-memory/runtime/` | generated indexes, exports, caches, and other runtime artifacts |

Runtime writes should not land in the source tree unless you are intentionally creating seed/example data.

## Build

```bash
cd engine
npm install
npm run build
```

## Environment

```bash
MEMORY_ROOT=$HOME/.agent-memory/memory
```

If `MEMORY_ROOT` is not set, the engine defaults to:

```text
~/.agent-memory/memory
```

For testing the included fake corpus:

```bash
MEMORY_ROOT=../examples/memory-store node dist/src/cli.js validate
```

## Invocation

```bash
node engine/dist/src/cli.js <command> [args]
```

All commands write structured JSON to stdout unless otherwise noted. Errors go to stderr. Exit code `0` means success; nonzero means failure or attention required.

## Session workflow

### 1. Retrieve bounded context

Preferred pattern: retrieve lazily after the first real prompt, using the prompt as the query.

```bash
node engine/dist/src/cli.js session-startup \
  --workspace /path/to/project \
  --session sess-123 \
  --query "what should the agent remember for this task?"
```

Useful options:

```text
--extra-scopes <scope1,scope2>
--limit <n>
--active-limit <n>
--durable-limit <n>
--policy-limit <n>
```

### 2. Record an observation during work

```bash
node engine/dist/src/cli.js session-record \
  --type decision \
  --summary "Use explicit promotion rather than raw transcript ingestion." \
  --workspace /path/to/project \
  --session sess-123 \
  --tags memory,lifecycle
```

This creates a staged event and a staged candidate. Staging is process state, not memory truth.

### 3. Promote staged candidates at session end

Preview:

```bash
node engine/dist/src/cli.js session-end --session sess-123 --dry-run
```

Apply:

```bash
node engine/dist/src/cli.js session-end --session sess-123
```

The live command promotes valid staged candidates, cleans staged artifacts, and rebuilds indexes.

## Common commands

```bash
node engine/dist/src/cli.js validate
node engine/dist/src/cli.js index
node engine/dist/src/cli.js retrieve --query "current focus" --workspace /path/to/project
node engine/dist/src/cli.js audit-active
```

Explainability:

```bash
node engine/dist/src/cli.js explain-retrieval --query "memory policy" --workspace /path/to/project
node engine/dist/src/cli.js explain-promotion --candidate /path/to/candidate.json
node engine/dist/src/cli.js explain-reconciliation --candidate /path/to/candidate.json
```

## Optional QMD export

This template can export derived Markdown documents for indexing by QMD or another retrieval system:

```bash
node engine/dist/src/cli.js export-qmd
node engine/dist/src/cli.js export-qmd --dry-run
node engine/dist/src/cli.js export-qmd --output-root /custom/export/path
```

Default export root:

```text
~/.agent-memory/runtime/qmd-memory/export
```

QMD is a separate project. See `../THIRD_PARTY_NOTICES.md`.

## Integration boundary

The engine owns memory-specific operations only:

- validation
- retrieval packet construction
- event/candidate staging
- promotion/suppression/reconciliation
- index rebuilding
- active-memory audit

The calling agent owns:

- deciding when memory is relevant
- asking the user for confirmation when needed
- injecting compact retrieval packets into prompts
- avoiding raw transcript dumps
- keeping runtime state out of source control
