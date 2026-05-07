# Comparisons

This project is not intended to replace larger memory platforms or stateful agent runtimes. It is a small, local-first memory governance layer that can complement them.

## mem0

[mem0](https://github.com/mem0ai/mem0) is a production-oriented memory layer for personalized AI applications. It provides SDKs, API/server options, cloud/self-hosted paths, hybrid retrieval, entity linking, and benchmarks.

Agent Memory Template is different:

- CLI-first and local-first
- focused on memory lifecycle rather than memory service infrastructure
- stages observations before promotion
- distinguishes active, durable, suppressed, and superseded records
- emphasizes scoped truth: global vs machine/project/workspace/operational validity
- treats human review and consent as core design concerns

A useful framing:

> mem0 helps applications remember. Agent Memory Template helps agent workflows decide what should become memory and where that memory is valid.

These can be complementary. A system could use a mem0-like backend while adopting this template's promotion, scope, and governance model above it.

## Letta

[Letta](https://github.com/letta-ai/letta), formerly MemGPT, is a stateful agent platform. It provides agents with memory, tools, skills/subagents, API/SDKs, and a coding-agent experience through Letta Code.

Agent Memory Template is not a full agent runtime. It does not own conversation orchestration, tool routing, hosted agents, or application APIs.

It focuses on questions like:

- What should count as memory?
- Was it reviewed or merely observed?
- Is it global, user-specific, machine-specific, project-specific, or operational?
- Is it active, durable, suppressed, or superseded?
- Should it be retrieved for this session?
- Is runtime state separated from authored source?

A useful framing:

> Letta helps you build stateful agents. Agent Memory Template is a portable governance pattern for reviewed, scoped memory lifecycles.

A Letta-style system could adopt this pattern for durable memory curation while still using its own agent runtime and memory blocks.

## Vector databases and raw transcript memory

This template intentionally avoids treating raw logs or embeddings as canonical memory.

Vector search can be useful, but retrieval support is not truth. Raw transcripts can be useful history, but history is not automatically memory.

The model here is:

1. observe an event
2. derive a compact candidate
3. validate and stage it
4. promote, suppress, or discard it
5. retrieve bounded context by scope and query

That lifecycle is the main value of the project.
