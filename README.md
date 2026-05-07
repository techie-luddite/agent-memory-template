# Agent Memory Template

A safe, publishable template for durable agent memory: compact authored truths, explicit staging and promotion, bounded retrieval, and clear separation between source and runtime state.

This is a **template**, not a personal memory dump. It includes a TypeScript memory engine, example corpus records, and design documents you can adapt for your own agent workflow.

## Core idea

Most agent memory systems fail by becoming one of three things:

- raw transcript hoards
- unreviewed vector-database soup
- brittle prompt stuffing

This template takes a stricter path:

1. Capture observations as events.
2. Derive compact candidate assertions.
3. Promote candidates explicitly into `active`, `durable`, or `suppressed` memory.
4. Retrieve only bounded, relevant packets for the current session.
5. Treat indexes and embeddings as retrieval support, not source of truth.

## Repository layout

```text
engine/                 TypeScript CLI memory engine
docs/                   Model and integration notes
examples/memory-store/  Small fake corpus for testing and adaptation
```

Runtime data should live outside the repo by default:

```text
~/.agent-memory/memory/
~/.agent-memory/runtime/
```

## Quick start

```bash
cd engine
npm install
npm run build
MEMORY_ROOT=../examples/memory-store npm run memory:validate
MEMORY_ROOT=../examples/memory-store node dist/src/cli.js retrieve --query "current focus" --workspace /path/to/example-project
```

## What this template includes

- JSON-schema validation for memory records
- active / durable / suppressed memory states
- event and candidate staging workflow
- promotion and suppression policy
- truth-class-aware reconciliation
- scope-aware bounded retrieval
- manifest/index rebuilding
- retrieval, promotion, and reconciliation explanation commands
- session startup / record / end commands for agent integration
- optional derived Markdown export hooks for external retrieval indexes

## Optional QMD integration

This template includes optional adapter/export code for use with [QMD — Query Markup Documents](https://github.com/tobi/qmd), an MIT-licensed on-device search engine by Tobi Lutke.

QMD is a separate project. This repository does not claim authorship of QMD. See [`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md) for attribution and license notes.

## Privacy posture

Before publishing or adapting your own fork, do **not** include:

- real user memories
- transcripts
- profile files
- credentials, hostnames, private IPs, tokens, machine names, or private paths
- personal relationship or identity material
- runtime stores, indexes, caches, or browser/tool state

Keep the pattern. Replace the people.

## Design principles

- Memory is authored truth, not raw logging.
- Staging is process state, not memory.
- Promotion, suppression, and invalidation are explicit.
- Retrieval is bounded and contextual.
- Runtime is disposable; source is reviewable.
- External indexes can help retrieval, but canonical truth stays in the memory corpus.

## License

This project is licensed under the Apache License 2.0. See [`LICENSE`](LICENSE).

## Status

This is an initial sanitized template extracted from a working private system. Treat it as a strong starting point, not a finished public product.

Aye, still mind the sharp edges. The useful bit is the architecture; adapt it deliberately.
