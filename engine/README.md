# Agent Memory Template Memory Engine

This directory contains the executable implementation of the Agent Memory Template memory subsystem.

It operates on a configurable memory store, defaulting to `~/.agent-memory/memory/`.

## Responsibilities

- load memory records
- validate memory records and schemas
- resolve scopes
- retrieve bounded memory sets
- build retrieval packets
- evaluate promotion and suppression rules
- rebuild lookup indexes and manifests
- process memory-specific events and candidates
- support staged event/candidate workflow under `~/.agent-memory/memory/staging/`
- reconcile candidates against existing memory with truth-class-aware policy
- apply shared subject semantics for reconciliation and retrieval
- explain retrieval, reconciliation, and promotion decisions
- audit active memory for stale records

## Non-Responsibilities

This engine does not own:
- general concierge behavior
- specialist routing
- TUI orchestration
- whole-system session management beyond memory-specific operational age tracking

## Boundary

- `engine/` is authored source.
- `examples/memory-store/` is a small fake corpus for tests and demos.
- `~/.agent-memory/memory/` is the default runtime memory store.
- generated indexes, caches, and runtime exports should not be committed.

## Integration

An agent integration can call this engine from the session lifecycle:
- calls `session-startup` at session start to inject memory context
- calls `session-end` at session shutdown to promote staged candidates

For the full caller protocol, see `../docs/INTEGRATION.md`.

## Source layout

```
src/
  audit/          — active memory review and stale detection
  candidates/     — event → candidate derivation
  events/         — event creation and validation
  explain/        — retrieval, reconciliation, and promotion explanation
  indexes/        — manifest and lookup index rebuilding
  load/           — corpus loading
  lock/           — mutation locking
  materialize/    — candidate → memory item materialization and reconciliation
  packets/        — retrieval packet assembly
  policy/         — truth-class, subject, lifecycle, and retrieval policy
  promotion/      — promotion target evaluation
  retrieval/      — retrieval set construction and ranking
  scopes/         — scope matching and scoring
  session/        — session scope derivation
  staging/        — staged event/candidate persistence
  subjects/       — subject derivation
  suppression/    — suppression evaluation
  types/          — shared TypeScript types
  validate/       — schema and corpus invariant validation
  cli.ts          — all CLI commands
```

## CLI commands

```
session:
  session-startup   -- retrieve memory context at session start
  session-record    -- record an observation to staging in one step
  session-end       -- promote staged candidates and clean staging

corpus management:
  validate          -- validate all records against schema and invariants
  index             -- rebuild lookup indexes and manifests
  audit-active      -- surface active records due or overdue for review

retrieval:
  retrieve          -- bounded retrieval packet with scope and query filtering

explainability:
  explain-retrieval       -- per-record ranking breakdown
  explain-reconciliation  -- step-by-step reconciliation walk
  explain-promotion       -- suppression and promotion path narration

events and candidates:
  record-event      -- create and optionally stage an event
  derive-candidate  -- derive and optionally stage a candidate from an event
  evaluate-candidate -- evaluate suppression and promotion for a candidate

staging:
  list-staged-events / list-staged-candidates
  validate-staged / staged-status
  delete-staged
  promote-candidate / promote-all-staged-candidates
```

## Design posture

- staged artifacts are resumable pipeline state, not memory truth
- candidates derive from exactly one source event (`derived_from` is typed as `[string]`)
- candidate tags preserve selected semantic event tags; scope is kept separate
- reconciliation is truth-class-aware rather than purely similarity-driven
- subject semantics are shared and centralized in `src/policy/subjectPolicy.ts`
- all semantic tuning lives in `src/policy/` — not scattered across modules
- writes are atomic (temp file + rename) in both staging and materialization
- mutation commands use advisory file locking
- `--dry-run` is available on promotion commands
- `--force` is required to override discard/suppress outcomes
