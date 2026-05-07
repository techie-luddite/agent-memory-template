# Agent Memory Template Memory Model

## Purpose

`agent-memory` stores compact, retrieval-safe, continuity-bearing truths that help reconstruct relevant context honestly across sessions.

It is not:
- a raw transcript store
- a general knowledge base
- a document archive
- a dumping ground for notes
- a replacement for `an external knowledge library`

## Core Principles

- Memory is primarily a retrieval policy system, not just a storage tree.
- Memory state and truth class are separate concepts.
- Raw events are not memory.
- Retrieval must be bounded.
- Promotion, suppression, and invalidation must be explicit.
- Scope matters; local truth can override generic truth.
- Operational decay should be driven by runtime activity, not wall-clock absence alone.

## Storage Layout

```text
.agent-memory/memory/
  active/
    <truth_class>/
  durable/
    <truth_class>/
  suppressed/
    <truth_class>/
  staging/
    events/
    candidates/
  schemas/
  indexes/
```

Within each memory state, items should normally be grouped by truth class:
- `active/<truth_class>/...`
- `durable/<truth_class>/...`
- `suppressed/<truth_class>/...`

### State meanings

- `active/`
  - currently retrievable memory that is still live, recent, or reinforced
  - includes hot, warm, and reinforced-active behavior through metadata rather than folder splits

- `durable/`
  - high-confidence, long-lived, curated memory

- `suppressed/`
  - recoverable memory excluded from normal retrieval

- `staging/`
  - resumable pipeline area for pre-memory artifacts
  - `staging/events/` holds validated event records when explicitly written
  - `staging/candidates/` holds validated candidate records when explicitly written
  - staging is operational queue state, not memory truth by itself

- `schemas/`
  - schema and policy artifacts for memory structure and lifecycle

- `indexes/`
  - retrieval-supporting manifests and lookup structures

## Memory Unit

A memory item should be a compact structured assertion, not a long document.

Good examples:
- stable environment facts
- durable preferences
- project structure rules
- active operational focus
- major decisions

Bad examples:
- full transcripts
- large docs
- command output dumps
- speculative chatter
- general reference knowledge better suited for library

## Truth Classes

Recommended truth classes:
- `preference`
  - user workflow, stylistic, or execution preferences
- `environment`
  - machine, OS, shell, hardware, toolchain, or runtime facts
- `project`
  - structural truths about a project or workspace as it exists
- `operational`
  - current focus, blockers, in-flight state, and near-term execution context
- `relationship`
  - repeatedly observed or explicitly stated interaction patterns that materially improve support quality
  - should not contain speculative emotional inference or flattering identity fiction
- `policy`
  - normative rules, constraints, and non-negotiable operating expectations
- `decision`
  - chosen paths where alternatives existed, especially with rationale or long-term implications

Quick tests:
- "what is true about the project?" -> `project`
- "what did we choose?" -> `decision`
- "what must or should be followed?" -> `policy`

## Scope Model

Examples:
- `user:local-user`
- `machine:workstation`
- `workspace:/home/example/.agent-memory`
- `workspace:/path/to/Agent Memory Template`
- `repo:agent-memory`
- `global`

## Lifecycle

### 1. Event
Raw structured observation from a session or tool run.

### 2. Candidate
A proposed memory assertion extracted from one or more events.

### 3. Memory
A candidate becomes memory when accepted into one of:
- `active`
- `durable`
- `suppressed`

Event and candidate schemas are defined now, and a narrow staging area exists under `staging/events/` and `staging/candidates/` for explicitly written, resumable pipeline artifacts.

Important boundary:
- staged events and candidates are still not memory
- staging is queue/process state, not truth promotion by itself
- memory begins only when a candidate is accepted into `active`, `durable`, or `suppressed`

## Promotion Rules

Promote to `active` when:
- directly relevant to current work
- a recent confirmed environment or project fact
- a recent user preference
- a current operational focus or blocker

Operational memories should normally begin in `active` and should carry operational review expectations rather than expiring simply because wall-clock time passed. If they are not reinforced across meaningful sessions or interactions, they should decay into suppression rather than lingering indefinitely.

Promote to `durable` when one or more are true:
- explicitly marked important by the user
- a major architectural or strategic decision
- a stable environment fact
- a policy or non-negotiable rule
- recurrence indicates persistence
- it materially affects future correctness

Move to `suppressed` when:
- stale but potentially useful later
- superseded but worth retaining
- too noisy for normal retrieval
- wrong outside original scope

Do not promote:
- one-off chatter
- raw tool output
- low-signal fragments
- bulky documentation

## Retrieval Policy

Default order:
1. classify request
2. resolve likely scopes
3. search `active`
4. if insufficient, search `durable`
5. search `suppressed` only on explicit request or strong trigger
6. inject a compact retrieval packet, never raw retrieval output

## Scoring Semantics

- `confidence`
  - how likely the assertion is true
- `importance`
  - how much it matters that the system remembers it
- `retrieval_weight`
  - how likely it should be surfaced during bounded retrieval

These are related but distinct. A memory can be very true and not very important, or important but not yet highly confident.

## Retrieval Bands Inside `active`

These are metadata-driven, not top-level folders:
- `hot`
- `warm`
- `reinforced`

Represent them through fields such as:
- `last_reinforced_at`
- `last_reinforced_in_session`
- `reinforcement_count`
- `retrieval_weight`
- `review_after_sessions`
- `review_after_interactions`
- `activity_state`

Wall-clock timestamps are retained for provenance, but should not be the primary decay mechanism for active memory.

## Invalidation and Revision

Each memory item should support:
- `status`
- `supersedes`
- `superseded_by`

`state` answers where the item lives operationally.
`status` answers whether the assertion is presently valid.

Durable memories should not expire just because elapsed time passed. They should be revised only when contradicted, superseded, invalidated, or deliberately demoted.

This prevents stale memory from masquerading as truth.

Operational memories may also be subject-exclusive by derived subject where appropriate. For example, a `current-focus` operational memory should normally supersede the previous `current-focus` memory rather than accumulate indefinitely. By contrast, durable decisions and policies should be conservative about supersession and should not be replaced on loose similarity alone.

## Naming

Memory ids and filenames should stay compact and predictable.

Recommended pattern:
- `mem_<date>_<subject>`
- filenames should match ids where practical

## Index Ownership

Indexes and manifests under `indexes/` should be treated as generated or semi-generated support artifacts unless explicitly documented otherwise. Policy docs remain hand-authored; lookup structures should not quietly become a second source of truth.

## Operational Age vs Wall Time

Absence is not contradiction.

If no meaningful work happened, memory should not decay simply because real time passed. Operational memory should age primarily through:
- session distance
- interaction distance
- newer related memories displacing older ones
- explicit completion, supersession, or invalidation

This means a long break should not erase continuity by itself.

## Boundary with Library

Memory should tell the system what matters.
Library should help the system look things up.

## Universal vs Environmental Truth

The model distinguishes broad truth from scoped truth through **scope** and **truth class**.

- Universal or broadly portable truths should usually use `scope: ["global"]` and a truth class such as `policy`, `preference`, or `decision` when they affect agent behavior across environments.
- Environmental truths should use `truth_class: "environment"` and explicit scopes such as `machine:<name>`, `workspace:<path>`, or `repo:<name>`.
- Project truths should use `truth_class: "project"` and a workspace/repo scope.
- Operational truths should be scoped to the session, workspace, project, or machine where they are actually valid.

Do not promote an environment-specific fact as global just because it is currently true. A memory that is correct in one machine, repo, or workflow can become actively harmful if retrieved as universal truth elsewhere.

Quick test:
- "Always ask before deleting user data" -> global policy
- "This repo uses pnpm" -> project/workspace fact
- "This machine stores runtime memory under `~/.agent-memory/`" -> machine/environment fact
- "The current task is debugging retrieval" -> operational workspace/session fact

## Boundary with Broader Knowledge Model

This memory model is not the entire future truth/knowledge architecture.
It covers continuity-bearing memory only.

The broader planned system may still include additional layers such as:
- foundational knowledge
  - broadly stable truths not specific to the current environment or project
- strategic or plural knowledge
  - cases where multiple valid approaches exist and tradeoffs matter
- colder archive/history layers
  - material retained for historical inspection without participating in normal retrieval

Those layers should remain conceptually separate from memory even when they later interact with memory retrieval or orchestration.
Do not collapse every kind of truth into the memory store just because memory happens to be implemented first.

## Subject Model

Subject is a lightweight semantic handle used to improve reconciliation, retrieval, and operator inspection.

Examples:
- `current-focus`
- `blocker`
- `priority-order`
- `policy`
- `machine`
- `project-structure`

Subject is not a replacement for truth class.
It is a secondary semantic axis used to:
- identify subject-exclusive operational memories
- strengthen reinforcement or supersession decisions where appropriate
- improve retrieval ranking for high-salience operational context
- support inspection and triage workflows

Subject derivation should remain explicit, shared, and conservative.
Do not let every subsystem invent its own incompatible subject semantics.
