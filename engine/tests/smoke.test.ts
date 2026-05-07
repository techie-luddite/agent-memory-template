import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, access, cp, mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import Ajv2020Module, { type ValidateFunction } from "ajv/dist/2020.js";
import addFormatsModule from "ajv-formats";
import { deriveCandidate, createMemoryCandidateValidator, primarySourceEventId, validateMemoryCandidate } from "../src/candidates/deriveCandidate.js";
import { main } from "../src/cli.js";
import { recordEvent, createMemoryEventValidator, validateMemoryEvent } from "../src/events/recordEvent.js";
import { buildRetrievalSet } from "../src/retrieval/buildRetrievalSet.js";
import { buildRetrievalPacket } from "../src/packets/buildRetrievalPacket.js";
import { rebuildIndexes } from "../src/indexes/rebuildIndexes.js";
import { calculateScopeScore, matchScopes } from "../src/scopes/matchScopes.js";
import { explainRetrieval } from "../src/explain/explainRetrieval.js";
import { deriveSessionScopes } from "../src/session/deriveSessionScopes.js";
import { explainReconciliation } from "../src/explain/explainReconciliation.js";
import { explainPromotion } from "../src/explain/explainPromotion.js";
import { loadMemoryRecords } from "../src/load/loadMemoryRecords.js";
import { withMemoryLock } from "../src/lock/withMemoryLock.js";
import { auditActiveMemory } from "../src/audit/auditActiveMemory.js";
import { exportQmd } from "../src/export/exportQmd.js";
import { buildQmdMemoryConfig } from "../src/qmd/config.js";
import { buildDefaultQmdQuery } from "../src/qmd/defaultRouting.js";
import { bootstrapQmdMemoryIndex } from "../src/qmd/bootstrapQmdIndex.js";
import { createQmdMemoryStore } from "../src/qmd/createQmdStore.js";
import { extractMemoryId, mapQmdResult } from "../src/qmd/mapQmdResults.js";
import { getQmdMemoryPaths } from "../src/qmd/paths.js";
import { resolveQmdHits } from "../src/qmd/resolveQmdHits.js";
import { retrieveMemoryWithQmd } from "../src/qmd/retrieveMemoryWithQmd.js";
import { retrieveWithDefaultQmdRouting } from "../src/qmd/retrieveWithDefaultQmdRouting.js";
import { searchQmdMemory } from "../src/qmd/searchQmdMemory.js";
import { getLifecyclePolicy, reviewDefaultsForState, shouldDiscardCandidate, shouldSuppressForLowSignal } from "../src/policy/lifecyclePolicy.js";
import { getRetrievalPolicy } from "../src/policy/retrievalPolicy.js";
import { getSubjectPolicy, subjectSignificanceBonus } from "../src/policy/subjectPolicy.js";
import { getTruthClassPolicy, prefersDurableByTruthClass } from "../src/policy/truthClassPolicy.js";
import { evaluatePromotion } from "../src/promotion/evaluatePromotion.js";
import { evaluateSuppression } from "../src/suppression/evaluateSuppression.js";
import {
  materializeCandidate,
  reconcileAndMaterializeCandidate,
  reconcileCandidateAgainstExisting
} from "../src/materialize/materializeCandidate.js";
import {
  deleteStagedRecord,
  listStagedRecords,
  readStagedRecord,
  writeStagedRecord
} from "../src/staging/stagingStore.js";
import { buildStagedStatusReport } from "../src/staging/buildStagedStatus.js";
import { deriveCandidateSubject, deriveMemoryItemSubject, subjectPriority } from "../src/subjects/deriveSubject.js";
import { createMemoryItemValidator, validateMemoryCorpus, validateMemoryItem } from "../src/validate/validateMemoryItem.js";
import type { LoadedMemoryRecord, MemoryItem } from "../src/types/MemoryItem.js";

function getMemoryRoot(): string {
  return path.resolve(process.cwd(), "..", "examples", "memory-store");
}

function buildValidMemoryItem(overrides: Partial<MemoryItem> = {}): MemoryItem {
  return {
    id: "mem_2026_04_16_test_record",
    state: "active",
    truth_class: "operational",
    scope: ["workspace:/tmp/test"],
    subject: "test-subject",
    summary: "Valid test memory item.",
    assertion: "This record exists to verify schema validation.",
    confidence: 0.9,
    importance: 0.8,
    retrieval_weight: 0.7,
    status: "confirmed",
    source: {
      type: "test",
      session: null,
      evidence: []
    },
    created_at: "2026-04-16T00:00:00Z",
    updated_at: "2026-04-16T00:00:00Z",
    last_reinforced_at: null,
    last_reinforced_in_session: null,
    reinforcement_count: 0,
    review_after_sessions: null,
    review_after_interactions: null,
    activity_state: "open",
    supersedes: [],
    superseded_by: null,
    tags: ["test"],
    ...overrides
  };
}

function buildLoadedRecord(overrides: Partial<MemoryItem> = {}): LoadedMemoryRecord {
  const item = buildValidMemoryItem(overrides);
  return {
    item,
    filePath: path.join("/tmp/test-memory", item.state, item.truth_class, `${item.id}.json`),
    stateDir: item.state,
    truthClassDir: item.truth_class
  };
}

async function readJson(filePath: string): Promise<any> {
  return JSON.parse(await readFile(filePath, "utf8"));
}

async function makeTestMemoryRoot(): Promise<string> {
  const memoryRoot = await mkdtemp(path.join(os.tmpdir(), "agent-memory-root-"));
  await cp(path.join(getMemoryRoot(), "schemas"), path.join(memoryRoot, "schemas"), { recursive: true });
  return memoryRoot;
}

async function createRetrievalPacketValidator(memoryRoot: string): Promise<ValidateFunction> {
  const schemaPath = path.join(memoryRoot, "schemas", "retrieval-packet.schema.json");
  const rawSchema = await readFile(schemaPath, "utf8");
  const schema = JSON.parse(rawSchema) as object;
  const Ajv = Ajv2020Module.default ?? Ajv2020Module;
  const addFormats = addFormatsModule.default ?? addFormatsModule;
  const ajv = new Ajv({ allErrors: true, strict: false });
  addFormats(ajv);
  return ajv.compile(schema);
}

async function captureConsole<T>(fn: () => Promise<T>): Promise<{ result: T; stdout: string[]; stderr: string[] }> {
  const stdout: string[] = [];
  const stderr: string[] = [];
  const originalLog = console.log;
  const originalError = console.error;

  console.log = (...args: unknown[]) => stdout.push(args.map((arg) => String(arg)).join(" "));
  console.error = (...args: unknown[]) => stderr.push(args.map((arg) => String(arg)).join(" "));

  try {
    const result = await fn();
    return { result, stdout, stderr };
  } finally {
    console.log = originalLog;
    console.error = originalError;
  }
}

test("recordEvent creates a valid event", async () => {
  const memoryRoot = getMemoryRoot();
  const validator = await createMemoryEventValidator(memoryRoot);
  const event = recordEvent({
    type: "decision",
    summary: "Memory should come before library.",
    source: {
      kind: "session",
      session: null,
      workspace: "/path/to/Agent Memory Template"
    },
    tags: ["decision", "important"]
  });

  assert.deepEqual(validateMemoryEvent(event, validator), []);
  assert.ok(event.id.startsWith("evt_"));
});

test("recordEvent ids stay unique for same-day same-summary events", () => {
  const first = recordEvent({
    type: "decision",
    summary: "Memory should come before library.",
    timestamp: "2026-04-16T10:00:00Z",
    source: {
      kind: "session",
      session: "sess-a",
      workspace: "/path/to/Agent Memory Template"
    }
  });
  const second = recordEvent({
    type: "decision",
    summary: "Memory should come before library.",
    timestamp: "2026-04-16T10:05:00Z",
    source: {
      kind: "session",
      session: "sess-b",
      workspace: "/path/to/Agent Memory Template"
    }
  });

  assert.notEqual(first.id, second.id);
});

test("staging store persists, lists, reads, and deletes staged records", async () => {
  const memoryRoot = await mkdtemp(path.join(os.tmpdir(), "agent-memory-staging-"));
  const event = recordEvent({
    type: "decision",
    summary: "Memory first, library later.",
    source: { kind: "session", session: null, workspace: "/path/to/Agent Memory Template" },
    tags: ["decision"]
  });
  const candidate = deriveCandidate(event);

  const stagedEvent = await writeStagedRecord(memoryRoot, "events", event.id, event);
  const stagedCandidate = await writeStagedRecord(memoryRoot, "candidates", candidate.id, candidate);

  const savedEvent = await readJson(stagedEvent.filePath);
  const savedCandidate = await readJson(stagedCandidate.filePath);
  const eventListing = await listStagedRecords(memoryRoot, "events");
  const candidateListing = await listStagedRecords(memoryRoot, "candidates");
  const readCandidate = await readStagedRecord<{ id: string }>(memoryRoot, "candidates", candidate.id);

  assert.equal(savedEvent.id, event.id);
  assert.equal(savedCandidate.id, candidate.id);
  assert.ok(stagedEvent.filePath.includes("/staging/events/"));
  assert.ok(stagedCandidate.filePath.includes("/staging/candidates/"));
  assert.equal(eventListing.length, 1);
  assert.equal(candidateListing.length, 1);
  assert.equal(readCandidate.payload.id, candidate.id);

  await deleteStagedRecord(memoryRoot, "candidates", candidate.id);
  const candidateListingAfterDelete = await listStagedRecords(memoryRoot, "candidates");
  assert.equal(candidateListingAfterDelete.length, 0);
});

test("staged candidate can be evaluated and promoted using staged linkage", async () => {
  const memoryRoot = await mkdtemp(path.join(os.tmpdir(), "agent-memory-stage-flow-"));
  const event = recordEvent({
    type: "decision",
    summary: "Memory first, library later.",
    source: { kind: "session", session: null, workspace: "/path/to/Agent Memory Template" },
    tags: ["decision", "important"]
  });
  const candidate = deriveCandidate(event);

  await writeStagedRecord(memoryRoot, "events", event.id, event);
  await writeStagedRecord(memoryRoot, "candidates", candidate.id, candidate);

  const stagedEvent = await readStagedRecord<Parameters<typeof validateMemoryEvent>[0]>(memoryRoot, "events", event.id);
  const stagedCandidate = await readStagedRecord<Parameters<typeof validateMemoryCandidate>[0]>(memoryRoot, "candidates", candidate.id);
  const eventValidator = await createMemoryEventValidator(getMemoryRoot());
  const candidateValidator = await createMemoryCandidateValidator(getMemoryRoot());

  assert.deepEqual(validateMemoryEvent(stagedEvent.payload, eventValidator), []);
  assert.deepEqual(validateMemoryCandidate(stagedCandidate.payload, candidateValidator), []);
});

test("buildStagedStatusReport summarizes promotable staged candidates", () => {
  const event = recordEvent({
    type: "decision",
    summary: "Memory first, library later.",
    source: { kind: "session", session: null, workspace: "/path/to/Agent Memory Template" },
    tags: ["decision", "important"]
  });
  const candidate = deriveCandidate(event);

  const report = buildStagedStatusReport({
    events: [
      {
        id: event.id,
        filePath: `/tmp/staging/events/${event.id}.json`,
        payload: event,
        validationErrors: []
      }
    ],
    candidates: [
      {
        id: candidate.id,
        filePath: `/tmp/staging/candidates/${candidate.id}.json`,
        payload: candidate,
        validationErrors: [],
        sourceEventPresent: true,
        suppression: { suppress: false, reasons: [] },
        promotion: { target: "durable", reasons: ["decision candidates should normally be durable"] }
      }
    ]
  });

  assert.equal(report.summary.event_count, 1);
  assert.equal(report.summary.candidate_count, 1);
  assert.equal(report.summary.promotable_candidates, 1);
  assert.equal(report.summary.candidates_missing_source_event, 0);
  assert.equal(report.candidates[0].promotion?.target, "durable");
});

test("deriveCandidate produces a valid candidate from an event", async () => {
  const memoryRoot = getMemoryRoot();
  const validator = await createMemoryCandidateValidator(memoryRoot);
  const event = recordEvent({
    type: "environment-confirmation",
    summary: "Surface device is the current mobile dev machine.",
    source: {
      kind: "inspection",
      session: null,
      workspace: "/path/to/Agent Memory Template"
    },
    tags: ["environment", "important"]
  });
  const candidate = deriveCandidate(event);

  assert.equal(candidate.truth_class, "environment");
  assert.equal(primarySourceEventId(candidate), event.id);
  assert.deepEqual(validateMemoryCandidate(candidate, validator), []);
});

test("validateMemoryCandidate rejects multi-source candidates", async () => {
  const memoryRoot = getMemoryRoot();
  const validator = await createMemoryCandidateValidator(memoryRoot);
  const candidate = deriveCandidate(
    recordEvent({
      type: "task-status",
      summary: "Current focus is refining staged workflow commands.",
      source: { kind: "session", session: null, workspace: "/path/to/Agent Memory Template" }
    })
  );

  const invalidCandidate = {
    ...candidate,
    derived_from: [candidate.derived_from[0], "evt_extra"]
  } as unknown as Parameters<typeof validateMemoryCandidate>[0];

  const errors = validateMemoryCandidate(invalidCandidate, validator);
  assert.ok(errors.some((error) => error.includes("must NOT have more than 1 items")));
});

test("deriveCandidate ids stay unique for same-day same-summary events", () => {
  const first = deriveCandidate(
    recordEvent({
      type: "task-status",
      summary: "Current focus is refining staged workflow commands.",
      timestamp: "2026-04-16T10:00:00Z",
      source: { kind: "session", session: "sess-a", workspace: "/path/to/Agent Memory Template" }
    })
  );
  const second = deriveCandidate(
    recordEvent({
      type: "task-status",
      summary: "Current focus is refining staged workflow commands.",
      timestamp: "2026-04-16T10:05:00Z",
      source: { kind: "session", session: "sess-b", workspace: "/path/to/Agent Memory Template" }
    })
  );

  assert.notEqual(first.id, second.id);
});

test("deriveCandidate preserves semantic tags but excludes scope tags", () => {
  const candidate = deriveCandidate(
    recordEvent({
      type: "task-status",
      summary: "Current focus is refining staged workflow commands.",
      source: { kind: "session", session: null, workspace: "/path/to/Agent Memory Template" },
      tags: ["current-focus", "important", "scope:repo:agent-memory"]
    })
  );

  assert.deepEqual(candidate.tags, ["current-focus", "important"]);
  assert.equal(deriveCandidateSubject(candidate), "current-focus");
});

test("subject derivation is consistent across candidates and memory items", () => {
  const focusCandidate = deriveCandidate(
    recordEvent({
      type: "task-status",
      summary: "Current focus is refining staged workflow commands.",
      source: { kind: "session", session: null, workspace: "/path/to/Agent Memory Template" },
      tags: ["current-focus"]
    })
  );

  const focusItem = buildValidMemoryItem({
    truth_class: "operational",
    summary: "Current focus is refining staged workflow commands.",
    assertion: "The current active work is refining staged workflow commands.",
    tags: ["current-focus"]
  });

  assert.equal(deriveCandidateSubject(focusCandidate), "current-focus");
  assert.equal(deriveMemoryItemSubject(focusItem), "current-focus");
  assert.ok(subjectPriority("current-focus") > subjectPriority("decision"));
});

test("truth class policy exposes durable preference and reconciliation config", () => {
  const decisionPolicy = getTruthClassPolicy("decision");
  const operationalPolicy = getTruthClassPolicy("operational");

  assert.equal(prefersDurableByTruthClass("decision"), true);
  assert.equal(prefersDurableByTruthClass("policy"), true);
  assert.equal(prefersDurableByTruthClass("operational"), false);
  assert.equal(decisionPolicy.allowSupersede, false);
  assert.equal(operationalPolicy.subjectExclusive, true);
});

test("subject policy exposes priority exclusivity and significance bonus", () => {
  const focusPolicy = getSubjectPolicy("current-focus");
  const blockerPolicy = getSubjectPolicy("blocker");
  const unknownPolicy = getSubjectPolicy("misc-subject");

  assert.equal(focusPolicy.priority, 3);
  assert.equal(focusPolicy.exclusiveOperational, true);
  assert.equal(subjectSignificanceBonus("current-focus"), 0.1);
  assert.equal(blockerPolicy.priority, 2);
  assert.equal(subjectSignificanceBonus("blocker"), 0.1);
  assert.equal(unknownPolicy.priority, 0);
  assert.equal(unknownPolicy.exclusiveOperational, false);
});

test("lifecycle policy exposes thresholds and active review defaults", () => {
  const lifecycle = getLifecyclePolicy();

  assert.equal(lifecycle.discardConfidenceThreshold, 0.45);
  assert.equal(lifecycle.suppressionSignificanceThreshold, 0.5);
  assert.deepEqual(reviewDefaultsForState("active"), {
    review_after_sessions: 6,
    review_after_interactions: 20,
    activity_state: "open"
  });
  assert.deepEqual(reviewDefaultsForState("durable"), {
    review_after_sessions: null,
    review_after_interactions: null,
    activity_state: null
  });
  assert.equal(shouldDiscardCandidate({ confidence: 0.44, significance: 0.9 }), true);
  assert.equal(shouldSuppressForLowSignal({ confidence: 0.59, significance: 0.49 }), true);
});

test("retrieval policy exposes explicit ranking scores", () => {
  const retrievalPolicy = getRetrievalPolicy();

  assert.equal(retrievalPolicy.exactSubjectQueryScore, 4);
  assert.equal(retrievalPolicy.summaryQueryScore, 3);
  assert.equal(retrievalPolicy.assertionQueryScore, 2);
  assert.equal(retrievalPolicy.tagQueryScore, 1.5);
  assert.equal(retrievalPolicy.partialQueryScore, 1);
});

test("evaluatePromotion prefers durable for decisions", () => {
  const candidate = deriveCandidate(
    recordEvent({
      type: "decision",
      summary: "Memory system design is prioritized before library design.",
      source: { kind: "session", session: null, workspace: "/path/to/Agent Memory Template" },
      tags: ["decision", "important", "durable"]
    })
  );

  const decision = evaluatePromotion(candidate);
  assert.equal(decision.target, "durable");
});

test("evaluatePromotion suppresses transient tool output", () => {
  const candidate = deriveCandidate(
    recordEvent({
      type: "tool-observation",
      summary: "Successfully wrote 15536 bytes to /path/to/dotfiles/bootstrap.sh",
      source: { kind: "session", session: null, workspace: "/home/example" }
    })
  );

  const decision = evaluatePromotion(candidate);
  assert.equal(decision.target, "suppressed");
  assert.ok(decision.reasons.some((reason) => reason.includes("transient") || reason.includes("trivial")));
});

test("evaluatePromotion suppresses casual current-focus prompts", () => {
  const candidate = deriveCandidate(
    recordEvent({
      type: "task-status",
      summary: "What about a Scottish one?",
      source: { kind: "session", session: null, workspace: "/home/example" },
      tags: ["current-focus"]
    })
  );

  const decision = evaluatePromotion(candidate);
  assert.equal(decision.target, "suppressed");
  assert.ok(decision.reasons.some((reason) => reason.includes("casual") || reason.includes("short")));
});

test("evaluatePromotion accepts explicit task-continuity current focus", () => {
  const candidate = deriveCandidate(
    recordEvent({
      type: "task-status",
      summary: "Current focus is implementing memory librarian gating before cleaning polluted active records.",
      source: { kind: "session", session: null, workspace: "/home/example" },
      tags: ["current-focus"]
    })
  );

  const decision = evaluatePromotion(candidate);
  assert.equal(decision.target, "active");
});

test("evaluateSuppression suppresses weak historical candidates", () => {
  const candidate = deriveCandidate(
    recordEvent({
      type: "user-statement",
      summary: "Old scratch note.",
      source: { kind: "session", session: null, workspace: "/tmp/old" },
      tags: []
    })
  );
  candidate.notes = "historical only";
  candidate.confidence = 0.4;
  candidate.significance = 0.3;

  const decision = evaluateSuppression(candidate);
  assert.equal(decision.suppress, true);
});

test("promote-candidate rejects forced target overrides without --force", async () => {
  const memoryRoot = await makeTestMemoryRoot();
  const candidate = deriveCandidate(
    recordEvent({
      type: "user-statement",
      summary: "Old scratch note.",
      timestamp: "2026-04-16T10:00:00Z",
      source: { kind: "session", session: null, workspace: "/tmp/old" },
      tags: []
    })
  );
  candidate.notes = "historical only";
  candidate.confidence = 0.4;
  candidate.significance = 0.3;

  const candidateFile = path.join(memoryRoot, "candidate.json");
  await writeFile(candidateFile, `${JSON.stringify(candidate, null, 2)}\n`, "utf8");

  const previousRoot = process.env.MEMORY_ROOT;
  process.env.MEMORY_ROOT = memoryRoot;

  try {
    const { result, stderr } = await captureConsole(() =>
      main(["promote-candidate", "--candidate-file", candidateFile, "--target", "durable", "--skip-index"])
    );

    assert.equal(result, 1);
    assert.ok(stderr.some((line) => line.includes("requires --force to override suppression")));
  } finally {
    if (previousRoot === undefined) {
      delete process.env.MEMORY_ROOT;
    } else {
      process.env.MEMORY_ROOT = previousRoot;
    }
  }
});

test("promote-candidate allows override with --force and emits warnings", async () => {
  const memoryRoot = await makeTestMemoryRoot();
  const candidate = deriveCandidate(
    recordEvent({
      type: "user-statement",
      summary: "Old scratch note.",
      timestamp: "2026-04-16T10:00:00Z",
      source: { kind: "session", session: null, workspace: "/tmp/old" },
      tags: []
    })
  );
  candidate.notes = "historical only";
  candidate.confidence = 0.4;
  candidate.significance = 0.3;

  const candidateFile = path.join(memoryRoot, "candidate.json");
  await writeFile(candidateFile, `${JSON.stringify(candidate, null, 2)}\n`, "utf8");

  const previousRoot = process.env.MEMORY_ROOT;
  process.env.MEMORY_ROOT = memoryRoot;

  try {
    const { result, stdout } = await captureConsole(() =>
      main(["promote-candidate", "--candidate-file", candidateFile, "--target", "durable", "--force", "--skip-index"])
    );

    assert.equal(result, 0);
    const payload = JSON.parse(stdout.join("\n"));
    assert.ok(Array.isArray(payload.warnings));
    assert.ok(payload.warnings.some((warning: string) => warning.includes("overrides evaluated target")));
    assert.ok(payload.warnings.some((warning: string) => warning.includes("bypassed suppression")));
    assert.equal(payload.materialized.state, "durable");
  } finally {
    if (previousRoot === undefined) {
      delete process.env.MEMORY_ROOT;
    } else {
      process.env.MEMORY_ROOT = previousRoot;
    }
  }
});

test("promote-candidate dry-run reports plan without writing files", async () => {
  const memoryRoot = await makeTestMemoryRoot();
  const candidate = deriveCandidate(
    recordEvent({
      type: "decision",
      summary: "Memory first, library later.",
      timestamp: "2026-04-16T10:00:00Z",
      source: { kind: "session", session: null, workspace: "/path/to/Agent Memory Template" },
      tags: ["decision", "important"]
    })
  );

  const candidateFile = path.join(memoryRoot, "candidate.json");
  await writeFile(candidateFile, `${JSON.stringify(candidate, null, 2)}\n`, "utf8");

  const previousRoot = process.env.MEMORY_ROOT;
  process.env.MEMORY_ROOT = memoryRoot;

  try {
    const { result, stdout } = await captureConsole(() =>
      main(["promote-candidate", "--candidate-file", candidateFile, "--dry-run"])
    );

    assert.equal(result, 0);
    const payload = JSON.parse(stdout.join("\n"));
    assert.equal(payload.dry_run, true);
    assert.equal(payload.materialized.id, candidate.id.replace(/^cand_/, "mem_"));
    const loaded = await loadMemoryRecords(memoryRoot);
    assert.deepEqual(loaded.records, []);
  } finally {
    if (previousRoot === undefined) {
      delete process.env.MEMORY_ROOT;
    } else {
      process.env.MEMORY_ROOT = previousRoot;
    }
  }
});

test("materializeCandidate writes a valid memory item to the target state path", async () => {
  const memoryRoot = await mkdtemp(path.join(os.tmpdir(), "agent-memory-materialize-"));
  const candidate = deriveCandidate(
    recordEvent({
      type: "decision",
      summary: "Memory first, library later.",
      source: { kind: "session", session: "sess-1", workspace: "/path/to/Agent Memory Template" },
      tags: ["decision", "important"]
    })
  );

  const materialized = await materializeCandidate(memoryRoot, {
    candidate,
    targetState: "durable",
    sessionId: "sess-1"
  });

  await access(materialized.filePath);
  const item = await readJson(materialized.filePath);
  const validator = await createMemoryItemValidator(getMemoryRoot());
  const errors = validateMemoryItem(
    {
      item,
      filePath: materialized.filePath,
      stateDir: "durable",
      truthClassDir: candidate.truth_class
    },
    validator
  );

  assert.deepEqual(errors, []);
  assert.equal(item.state, "durable");
  assert.equal(item.source.type, "candidate-promotion");
});

test("materializeCandidate carries candidate semantic tags into memory items", async () => {
  const memoryRoot = await mkdtemp(path.join(os.tmpdir(), "agent-memory-materialize-tags-"));
  const candidate = deriveCandidate(
    recordEvent({
      type: "task-status",
      summary: "Current focus is refining staged workflow commands.",
      source: { kind: "session", session: "sess-1", workspace: "/path/to/Agent Memory Template" },
      tags: ["current-focus", "important", "scope:repo:agent-memory"]
    })
  );

  const materialized = await materializeCandidate(memoryRoot, {
    candidate,
    targetState: "active",
    sessionId: "sess-1"
  });

  assert.ok(materialized.item.tags.includes("current-focus"));
  assert.ok(materialized.item.tags.includes("important"));
  assert.ok(!materialized.item.tags.includes("scope:repo:agent-memory"));
});

test("reconcileCandidateAgainstExisting reinforces exact duplicates", async () => {
  const memoryRoot = await mkdtemp(path.join(os.tmpdir(), "agent-memory-reconcile-"));
  const existing = await materializeCandidate(memoryRoot, {
    candidate: deriveCandidate(
      recordEvent({
        type: "decision",
        summary: "Memory system design is prioritized before library design.",
        source: { kind: "session", session: null, workspace: "/path/to/Agent Memory Template" },
        tags: ["decision", "important"]
      })
    ),
    targetState: "durable",
    sessionId: "sess-a"
  });

  const duplicateCandidate = deriveCandidate(
    recordEvent({
      type: "decision",
      summary: "Memory system design is prioritized before library design.",
      source: { kind: "session", session: null, workspace: "/path/to/Agent Memory Template" },
      tags: ["decision", "important"]
    })
  );

  const decision = reconcileCandidateAgainstExisting(duplicateCandidate, [
    {
      item: existing.item,
      filePath: existing.filePath,
      stateDir: existing.item.state,
      truthClassDir: existing.item.truth_class
    }
  ]);

  assert.equal(decision.action, "reinforce");
});

test("decision revisions create new memories rather than superseding by loose similarity", async () => {
  const memoryRoot = await mkdtemp(path.join(os.tmpdir(), "agent-memory-decision-policy-"));
  const existing = await materializeCandidate(memoryRoot, {
    candidate: deriveCandidate(
      recordEvent({
        type: "decision",
        summary: "Memory system design is prioritized before library design.",
        source: { kind: "session", session: null, workspace: "/path/to/Agent Memory Template" },
        tags: ["decision", "important"]
      })
    ),
    targetState: "durable"
  });

  const revisedDecision = deriveCandidate(
    recordEvent({
      type: "decision",
      summary: "Memory system design is prioritized before broader library expansion.",
      source: { kind: "session", session: null, workspace: "/path/to/Agent Memory Template" },
      tags: ["decision", "important"]
    })
  );

  const decision = reconcileCandidateAgainstExisting(revisedDecision, [
    {
      item: existing.item,
      filePath: existing.filePath,
      stateDir: existing.item.state,
      truthClassDir: existing.item.truth_class
    }
  ]);

  assert.equal(decision.action, "create");
});


test("operational current-focus candidates supersede prior current-focus memory", async () => {
  const memoryRoot = await mkdtemp(path.join(os.tmpdir(), "agent-memory-operational-policy-"));
  const existing = await materializeCandidate(memoryRoot, {
    candidate: deriveCandidate(
      recordEvent({
        type: "task-status",
        summary: "Current focus is designing the Agent Memory Template memory architecture and starter schemas.",
        source: { kind: "session", session: null, workspace: "/path/to/Agent Memory Template" },
        tags: ["current-focus"]
      })
    ),
    targetState: "active"
  });

  const nextFocus = deriveCandidate(
    recordEvent({
      type: "task-status",
      summary: "Current focus is refining staged workflow commands and triage output.",
      source: { kind: "session", session: null, workspace: "/path/to/Agent Memory Template" },
      tags: ["current-focus"]
    })
  );

  const decision = reconcileCandidateAgainstExisting(nextFocus, [
    {
      item: existing.item,
      filePath: existing.filePath,
      stateDir: existing.item.state,
      truthClassDir: existing.item.truth_class
    }
  ]);

  assert.equal(decision.action, "supersede");
  assert.equal(decision.reason.includes("subject-bound operational memory"), true);
});

test("generic operational candidates do not supersede by broad subject alone", async () => {
  const memoryRoot = await mkdtemp(path.join(os.tmpdir(), "agent-memory-operational-generic-"));
  const existing = await materializeCandidate(memoryRoot, {
    candidate: deriveCandidate(
      recordEvent({
        type: "task-status",
        summary: "Triage memory validation failures.",
        source: { kind: "session", session: null, workspace: "/path/to/Agent Memory Template" },
        tags: []
      })
    ),
    targetState: "active"
  });

  const nextOperational = deriveCandidate(
    recordEvent({
      type: "task-status",
      summary: "Review retrieval ranking behavior.",
      source: { kind: "session", session: null, workspace: "/path/to/Agent Memory Template" },
      tags: []
    })
  );

  const decision = reconcileCandidateAgainstExisting(nextOperational, [
    {
      item: existing.item,
      filePath: existing.filePath,
      stateDir: existing.item.state,
      truthClassDir: existing.item.truth_class
    }
  ]);

  assert.equal(existing.item.subject, null);
  assert.equal(nextOperational.truth_class, "operational");
  assert.equal(decision.action, "create");
});

test("reconcileAndMaterializeCandidate supersedes close revisions", async () => {
  const memoryRoot = await mkdtemp(path.join(os.tmpdir(), "agent-memory-supersede-"));
  const existing = await materializeCandidate(memoryRoot, {
    candidate: deriveCandidate(
      recordEvent({
        type: "task-status",
        summary: "Current focus is designing the Agent Memory Template memory architecture and starter schemas.",
        source: { kind: "session", session: null, workspace: "/path/to/Agent Memory Template" },
        tags: ["current-focus"]
      })
    ),
    targetState: "active",
    sessionId: "sess-a"
  });

  const revisionCandidate = deriveCandidate(
    recordEvent({
      type: "task-status",
      summary: "Current focus is implementing the Agent Memory Template memory engine and starter schemas.",
      source: { kind: "session", session: null, workspace: "/path/to/Agent Memory Template" },
      details: "The current active work is implementing the memory engine, retrieval logic, and candidate promotion path.",
      tags: ["current-focus", "important"]
    })
  );

  const result = await reconcileAndMaterializeCandidate(
    memoryRoot,
    {
      candidate: revisionCandidate,
      targetState: "active",
      sessionId: "sess-b"
    },
    [
      {
        item: existing.item,
        filePath: existing.filePath,
        stateDir: existing.item.state,
        truthClassDir: existing.item.truth_class
      }
    ]
  );

  assert.equal(result.decision.action, "supersede");
  assert.equal(result.materialized.item.supersedes?.includes(existing.item.id), true);
  assert.equal(result.superseded?.item.status, "superseded");
  assert.equal(result.superseded?.item.state, "suppressed");
});

test("explainRetrieval identifies why records are excluded", () => {
  const explanation = explainRetrieval(
    [
      buildValidMemoryItem({
        id: "mem_superseded",
        state: "active",
        status: "superseded",
        subject: "current-focus",
        summary: "Old focus task.",
        assertion: "Work was on the old focus task."
      }),
      buildValidMemoryItem({
        id: "mem_no_match",
        state: "active",
        subject: "blocker",
        summary: "Unrelated memory.",
        assertion: "Something unrelated."
      }),
      buildValidMemoryItem({
        id: "mem_match",
        state: "active",
        subject: "current-focus",
        summary: "Current focus is refining retrieval.",
        assertion: "The current active work is retrieval refinement."
      })
    ],
    { query: "retrieval" }
  );

  const superseded = explanation.records.find((r) => r.id === "mem_superseded");
  const noMatch = explanation.records.find((r) => r.id === "mem_no_match");
  const match = explanation.records.find((r) => r.id === "mem_match");

  assert.ok(superseded?.exclusion_reason?.includes("superseded"));
  assert.ok(noMatch?.exclusion_reason?.includes("does not match query"));
  assert.equal(match?.included, true);
  assert.ok(match?.query_match_field?.includes("summary"));
  assert.equal(match?.scores.subject_priority, 3);
});

test("explainRetrieval shows scope scores", () => {
  const explanation = explainRetrieval(
    [
      buildValidMemoryItem({
        id: "mem_exact_scope",
        state: "active",
        scope: ["workspace:/path/to/Agent Memory Template/memory"],
        subject: null,
        summary: "Active memory for specific workspace.",
        assertion: "This memory belongs to the specific workspace."
      }),
      buildValidMemoryItem({
        id: "mem_global_scope",
        state: "active",
        scope: ["global"],
        subject: null,
        summary: "Global memory for all workspaces.",
        assertion: "This memory applies globally."
      })
    ],
    { requestedScopes: ["workspace:/path/to/Agent Memory Template/memory"] }
  );

  const exact = explanation.records.find((r) => r.id === "mem_exact_scope");
  const global = explanation.records.find((r) => r.id === "mem_global_scope");

  assert.ok(exact!.scores.scope > global!.scores.scope);
});

test("explainReconciliation identifies reinforce outcome for duplicate", async () => {
  const memoryRoot = await mkdtemp(path.join(os.tmpdir(), "agent-memory-explain-reconcile-"));
  const event = recordEvent({
    type: "decision",
    summary: "Memory system design is prioritized before library design.",
    source: { kind: "session", session: null, workspace: "/path/to/Agent Memory Template" },
    tags: ["decision", "important"]
  });
  const existing = await materializeCandidate(memoryRoot, {
    candidate: deriveCandidate(event),
    targetState: "durable"
  });

  const duplicateCandidate = deriveCandidate(
    recordEvent({
      type: "decision",
      summary: "Memory system design is prioritized before library design.",
      source: { kind: "session", session: null, workspace: "/path/to/Agent Memory Template" },
      tags: ["decision", "important"]
    })
  );

  const explanation = explainReconciliation(duplicateCandidate, [
    {
      item: existing.item,
      filePath: existing.filePath,
      stateDir: existing.item.state,
      truthClassDir: existing.item.truth_class
    }
  ]);

  assert.equal(explanation.outcome.action, "reinforce");
  assert.equal(explanation.outcome.existing_id, existing.item.id);
  assert.ok(explanation.checks.some((c) => c.check === "duplicate detection" && c.passed));
});

test("explainReconciliation identifies create outcome for novel candidate", () => {
  const candidate = deriveCandidate(
    recordEvent({
      type: "decision",
      summary: "Memory indexing should be separate from retrieval.",
      source: { kind: "session", session: null, workspace: "/path/to/Agent Memory Template" },
      tags: ["decision"]
    })
  );

  const explanation = explainReconciliation(candidate, []);

  assert.equal(explanation.outcome.action, "create");
  assert.equal(explanation.outcome.existing_id, null);
  assert.ok(explanation.checks.some((c) => c.check === "create fallthrough" && c.passed));
  assert.equal(explanation.eligible_existing, 0);
});

test("explainPromotion narrates suppression of weak historical candidates", () => {
  const candidate = deriveCandidate(
    recordEvent({
      type: "user-statement",
      summary: "Old scratch note.",
      source: { kind: "session", session: null, workspace: "/tmp/old" },
      tags: []
    })
  );
  candidate.notes = "historical only";
  candidate.confidence = 0.4;
  candidate.significance = 0.3;

  const explanation = explainPromotion(candidate);

  assert.equal(explanation.suppression.suppressed, true);
  assert.equal(explanation.promotion.target, "suppressed");
  assert.ok(explanation.suppression.reasons.some((r) => r.includes("historical-only")));
  assert.ok(explanation.suppression.checks.some((c) => c.check === "low-signal candidate" && c.passed));
  assert.ok(explanation.suppression.checks.some((c) => c.check === "historical-only marker" && c.passed));
});

test("explainPromotion narrates durable promotion for decision candidates", () => {
  const candidate = deriveCandidate(
    recordEvent({
      type: "decision",
      summary: "Memory system design is prioritized before library design.",
      source: { kind: "session", session: null, workspace: "/path/to/Agent Memory Template" },
      tags: ["decision", "important"]
    })
  );

  const explanation = explainPromotion(candidate);

  assert.equal(explanation.suppression.suppressed, false);
  assert.equal(explanation.promotion.target, "durable");
  assert.ok(explanation.promotion.checks.some((c) => c.check === "durable by truth-class" && c.passed));
  assert.equal(explanation.truth_class, "decision");
});

test("buildRetrievalSet returns bounded active and durable records", () => {
  const result = buildRetrievalSet(
    [
      buildValidMemoryItem({
        id: "mem_active_a",
        state: "active",
        subject: "current-focus",
        summary: "Current focus is implementing the memory retrieval gate for startup context.",
        assertion: "The active task is implementing memory retrieval gating for startup context.",
        tags: ["current-focus"],
        retrieval_weight: 0.8,
        importance: 0.9
      }),
      buildValidMemoryItem({ id: "mem_active_b", state: "active", subject: "test-subject", retrieval_weight: 0.95, importance: 0.8 }),
      buildValidMemoryItem({ id: "mem_durable_a", state: "durable", truth_class: "decision", retrieval_weight: 0.95, importance: 0.85 })
    ],
    { limit: 2, activeLimit: 1, durableLimit: 1 }
  );

  assert.equal(result.active.length, 1);
  assert.equal(result.active[0].id, "mem_active_a");
  assert.equal(result.durable.length, 1);
  assert.equal(result.durable[0].id, "mem_durable_a");
});

test("matchScopes supports workspace hierarchy and global fallback", () => {
  assert.equal(
    matchScopes(["workspace:/path/to/Agent Memory Template", "repo:agent-memory"], ["workspace:/path/to/Agent Memory Template/memory"]),
    true
  );
  assert.equal(matchScopes(["global"], ["workspace:/path/to/Agent Memory Template/memory"]), true);
  assert.equal(matchScopes(["repo:agent-memory"], ["workspace:/path/to/Agent Memory Template/memory"]), false);
  assert.ok(
    calculateScopeScore(["workspace:/path/to/Agent Memory Template/memory"], ["workspace:/path/to/Agent Memory Template/memory"]) >
      calculateScopeScore(["global"], ["workspace:/path/to/Agent Memory Template/memory"])
  );
});

test("buildRetrievalSet prefers exact scope over global fallback", () => {
  const result = buildRetrievalSet(
    [
      buildValidMemoryItem({
        id: "mem_exact_scope",
        state: "active",
        scope: ["workspace:/path/to/Agent Memory Template/memory"],
        subject: "test-subject",
        retrieval_weight: 0.7,
        importance: 0.7
      }),
      buildValidMemoryItem({
        id: "mem_global_scope",
        state: "active",
        scope: ["global"],
        subject: "current-focus",
        retrieval_weight: 0.95,
        importance: 0.95
      })
    ],
    { requestedScopes: ["workspace:/path/to/Agent Memory Template/memory"], activeLimit: 2, limit: 2 }
  );

  assert.equal(result.active[0].id, "mem_exact_scope");
});

test("buildRetrievalSet surfaces policies separately", () => {
  const result = buildRetrievalSet([
    buildValidMemoryItem({ id: "mem_policy", state: "durable", truth_class: "policy", retrieval_weight: 0.99, importance: 0.99 }),
    buildValidMemoryItem({ id: "mem_active", state: "active", truth_class: "operational" })
  ]);

  assert.equal(result.policies.length, 1);
  assert.equal(result.policies[0].id, "mem_policy");
  assert.equal(result.active.length, 1);
});

test("buildRetrievalSet query matches subject-only records", () => {
  const result = buildRetrievalSet(
    [
      buildValidMemoryItem({
        id: "mem_subject_hit",
        state: "active",
        subject: "current-focus",
        summary: "Refining staged workflow commands.",
        assertion: "Work is currently centered on staged command refinement.",
        tags: ["operational"]
      }),
      buildValidMemoryItem({
        id: "mem_other",
        state: "active",
        subject: "blocker",
        summary: "Investigate validation path mismatch.",
        assertion: "A mismatch is affecting validation.",
        tags: ["operational"]
      })
    ],
    { query: "current-focus" }
  );

  assert.equal(result.active.length, 1);
  assert.equal(result.active[0].id, "mem_subject_hit");
});

test("buildRetrievalSet query filters out non-matching records", () => {
  const result = buildRetrievalSet(
    [
      buildValidMemoryItem({
        id: "mem_alpha",
        state: "active",
        subject: "current-focus",
        summary: "Refining staged workflow commands.",
        assertion: "Work is currently centered on staged command refinement.",
        tags: ["operational"]
      }),
      buildValidMemoryItem({
        id: "mem_beta",
        state: "durable",
        truth_class: "decision",
        subject: "priority-order",
        summary: "Memory before library.",
        assertion: "The memory engine is prioritized before library work.",
        tags: ["decision"]
      })
    ],
    { query: "surface-device" }
  );

  assert.equal(result.active.length, 0);
  assert.equal(result.durable.length, 0);
  assert.equal(result.policies.length, 0);
});

test("buildRetrievalPacket shapes packet items with metadata", async () => {
  const retrievalSet = buildRetrievalSet([
    buildValidMemoryItem({ id: "mem_active", state: "active", truth_class: "operational", subject: "focus" }),
    buildValidMemoryItem({ id: "mem_policy", state: "durable", truth_class: "policy", subject: "rules" })
  ]);
  const packet = buildRetrievalPacket("focus", ["workspace:/tmp/test"], retrievalSet);
  const validator = await createRetrievalPacketValidator(getMemoryRoot());

  assert.equal(packet.query, "focus");
  assert.equal(packet.active[0].id, "mem_active");
  assert.equal(packet.active[0].truth_class, "operational");
  assert.equal(packet.policies[0].id, "mem_policy");
  assert.equal(validator(packet), true, JSON.stringify(validator.errors, null, 2));
});

test("validateMemoryItem accepts a schema-valid record", async () => {
  const validator = await createMemoryItemValidator(getMemoryRoot());
  const errors = validateMemoryItem(buildLoadedRecord(), validator);

  assert.deepEqual(errors, []);
});

test("validateMemoryItem rejects schema-invalid records", async () => {
  const validator = await createMemoryItemValidator(getMemoryRoot());
  const errors = validateMemoryItem(
    buildLoadedRecord({
      source: undefined as unknown as MemoryItem["source"]
    }),
    validator
  );

  assert.ok(errors.some((error) => error.includes("schema")));
});

test("validateMemoryItem rejects path mismatches", async () => {
  const validator = await createMemoryItemValidator(getMemoryRoot());
  const record = buildLoadedRecord();
  record.stateDir = "durable";
  const errors = validateMemoryItem(record, validator);

  assert.ok(errors.some((error) => error.includes("path state")));
});

test("validateMemoryCorpus rejects active superseded records", () => {
  const errors = validateMemoryCorpus([
    buildLoadedRecord({
      id: "mem_bad_superseded",
      state: "active",
      status: "superseded",
      superseded_by: "mem_replacement"
    }),
    buildLoadedRecord({
      id: "mem_replacement",
      state: "durable",
      truth_class: "decision",
      supersedes: ["mem_bad_superseded"]
    })
  ]);

  assert.ok(errors.some((error) => error.includes("superseded records must be in suppressed state")));
  assert.ok(errors.some((error) => error.includes("active records cannot have superseded status")));
});

test("validateMemoryCorpus rejects broken supersession references", () => {
  const errors = validateMemoryCorpus([
    buildLoadedRecord({
      id: "mem_orphaned",
      state: "suppressed",
      status: "superseded",
      superseded_by: "mem_missing"
    }),
    buildLoadedRecord({
      id: "mem_replacement",
      state: "durable",
      truth_class: "decision",
      supersedes: ["mem_missing_prior"]
    })
  ]);

  assert.ok(errors.some((error) => error.includes("superseded_by references missing record 'mem_missing'")));
  assert.ok(errors.some((error) => error.includes("supersedes references missing record 'mem_missing_prior'")));
});

test("loadMemoryRecords returns deterministic ordering", async () => {
  const memoryRoot = await mkdtemp(path.join(os.tmpdir(), "agent-memory-load-order-"));
  const records = [
    buildValidMemoryItem({ id: "mem_b", state: "active", truth_class: "project" }),
    buildValidMemoryItem({ id: "mem_a", state: "active", truth_class: "decision" }),
    buildValidMemoryItem({ id: "mem_c", state: "durable", truth_class: "operational" })
  ];

  for (const item of records) {
    const filePath = path.join(memoryRoot, item.state, item.truth_class, `${item.id}.json`);
    await mkdir(path.dirname(filePath), { recursive: true });
    await writeFile(filePath, `${JSON.stringify(item, null, 2)}\n`, { encoding: "utf8", flag: "w" });
  }

  const loaded = await loadMemoryRecords(memoryRoot);
  assert.deepEqual(loaded.errors, []);
  assert.deepEqual(
    loaded.records.map((record) => `${record.item.state}/${record.item.truth_class}/${record.item.id}`),
    [
      "active/decision/mem_a",
      "active/project/mem_b",
      "durable/operational/mem_c"
    ]
  );
});

test("deriveSessionScopes includes workspace, ancestors, and global", () => {
  const scopes = deriveSessionScopes({
    workspace: "/home/example/dev/project/memory",
    ancestorDepth: 3
  });

  assert.ok(scopes.includes("workspace:/home/example/dev/project/memory"));
  assert.ok(scopes.includes("workspace:/home/example/dev/project"));
  assert.ok(scopes.includes("workspace:/home/example/dev"));
  assert.ok(scopes.includes("global"));
});

test("auditActiveMemory marks records ok when within thresholds", () => {
  const audit = auditActiveMemory(
    [
      buildLoadedRecord({
        id: "mem_active_fresh",
        state: "active",
        review_after_sessions: 6,
        review_after_interactions: 20,
        reinforcement_count: 1,
        last_reinforced_at: "2026-04-16T00:00:00Z"
      })
    ],
    { sessionsSinceReinforcement: 2, interactionsSinceReinforcement: 5 }
  );

  assert.equal(audit.summary.ok, 1);
  assert.equal(audit.summary.due, 0);
  assert.equal(audit.needs_attention, false);
  assert.equal(audit.records[0].review_status, "ok");
});

test("auditActiveMemory marks records due at threshold", () => {
  const audit = auditActiveMemory(
    [
      buildLoadedRecord({
        id: "mem_active_due",
        state: "active",
        review_after_sessions: 6,
        review_after_interactions: 20,
        reinforcement_count: 1,
        last_reinforced_at: "2026-04-10T00:00:00Z"
      })
    ],
    { sessionsSinceReinforcement: 6, interactionsSinceReinforcement: 10 }
  );

  assert.equal(audit.summary.due, 1);
  assert.equal(audit.needs_attention, true);
  assert.ok(audit.records[0].review_reasons.some((r) => r.includes("due")));
});

test("auditActiveMemory marks records overdue beyond 1.5x threshold", () => {
  const audit = auditActiveMemory(
    [
      buildLoadedRecord({
        id: "mem_active_overdue",
        state: "active",
        review_after_sessions: 6,
        review_after_interactions: 20,
        reinforcement_count: 1,
        last_reinforced_at: "2026-04-01T00:00:00Z"
      })
    ],
    { sessionsSinceReinforcement: 10, interactionsSinceReinforcement: 35 }
  );

  assert.equal(audit.summary.overdue, 1);
  assert.equal(audit.needs_attention, true);
  assert.ok(audit.records[0].review_reasons.some((r) => r.includes("overdue")));
});

test("auditActiveMemory marks no-threshold when no elapsed counts given", () => {
  const audit = auditActiveMemory([
    buildLoadedRecord({
      id: "mem_active_no_elapsed",
      state: "active",
      review_after_sessions: 6,
      review_after_interactions: 20,
      reinforcement_count: 1
    })
  ]);

  assert.equal(audit.summary.no_threshold, 1);
  assert.equal(audit.needs_attention, false);
});

test("exportQmd writes derived markdown and manifest", async () => {
  const outputRoot = await mkdtemp(path.join(os.tmpdir(), "agent-qmd-export-"));
  const records: LoadedMemoryRecord[] = [
    buildLoadedRecord({
      id: "mem_focus",
      state: "active",
      truth_class: "operational",
      subject: "current-focus",
      summary: "Current focus is debugging memory retrieval reliability.",
      assertion: "The current active work is debugging memory retrieval reliability.",
      scope: ["workspace:/home/example"]
    }),
    buildLoadedRecord({
      id: "mem_policy_capture",
      state: "durable",
      truth_class: "policy",
      subject: "policy",
      summary: "Interactive confirmations must autopromote.",
      assertion: "Confirmed captures should record and promote immediately.",
      scope: ["workspace:/home/example"]
    })
  ];

  const result = await exportQmd(records, { outputRoot });

  assert.equal(result.exported, 2);
  assert.equal(result.collections["memory-active"], 1);
  assert.equal(result.collections["memory-policy"], 1);

  const focusDocPath = path.join(outputRoot, "memory-active", "operational", "mem_focus.md");
  const policyDocPath = path.join(outputRoot, "memory-policy", "policy", "mem_policy_capture.md");
  const manifest = await readJson(path.join(outputRoot, "manifest.json"));
  const focusDoc = await readFile(focusDocPath, "utf8");
  const policyDoc = await readFile(policyDocPath, "utf8");

  assert.ok(focusDoc.includes("memory_id: \"mem_focus\""));
  assert.ok(focusDoc.includes("## Retrieval hints"));
  assert.ok(focusDoc.includes("what we are focused on"));
  assert.ok(policyDoc.includes("Interactive confirmations must autopromote."));
  assert.equal(manifest.exported, 2);
  assert.equal(manifest.files.length, 2);
});

test("exportQmd dry-run reports stale files without writing", async () => {
  const outputRoot = await mkdtemp(path.join(os.tmpdir(), "agent-qmd-dry-run-"));
  const stalePath = path.join(outputRoot, "memory-active", "operational", "stale.md");
  await mkdir(path.dirname(stalePath), { recursive: true });
  await writeFile(stalePath, "stale\n", "utf8");

  const result = await exportQmd([
    buildLoadedRecord({
      id: "mem_focus",
      state: "active",
      truth_class: "operational",
      summary: "Current focus is debugging memory retrieval reliability.",
      assertion: "The current active work is debugging memory retrieval reliability."
    })
  ], { outputRoot, dryRun: true });

  assert.equal(result.exported, 1);
  assert.equal(result.removed, 1);
  assert.ok(result.removed_files.includes(path.join("memory-active", "operational", "stale.md")));
  assert.equal(await readFile(stalePath, "utf8"), "stale\n");
});

test("export-qmd CLI writes derived markdown export", async () => {
  const memoryRoot = await makeTestMemoryRoot();
  const outputRoot = await mkdtemp(path.join(os.tmpdir(), "agent-qmd-cli-"));
  const previousRoot = process.env.MEMORY_ROOT;
  const previousExportRoot = process.env.MEMORY_QMD_EXPORT_ROOT;
  process.env.MEMORY_ROOT = memoryRoot;
  process.env.MEMORY_QMD_EXPORT_ROOT = outputRoot;

  const activeItem = buildValidMemoryItem({
    id: "mem_cli_focus",
    state: "active",
    truth_class: "operational",
    subject: "current-focus",
    summary: "Current focus is debugging memory retrieval reliability.",
    assertion: "The current active work is debugging memory retrieval reliability."
  });
  const durableItem = buildValidMemoryItem({
    id: "mem_cli_decision",
    state: "durable",
    truth_class: "decision",
    subject: "decision",
    summary: "Use QMD as indexing and query method for memory retrieval.",
    assertion: "QMD should provide indexing and query-time retrieval while Agent Memory Template memory remains canonical."
  });

  for (const item of [activeItem, durableItem]) {
    const filePath = path.join(memoryRoot, item.state, item.truth_class, `${item.id}.json`);
    await mkdir(path.dirname(filePath), { recursive: true });
    await writeFile(filePath, `${JSON.stringify(item, null, 2)}\n`, "utf8");
  }

  try {
    const { result, stdout } = await captureConsole(() => main(["export-qmd"]));

    assert.equal(result, 0);
    const payload = JSON.parse(stdout.join("\n"));
    assert.equal(payload.exported, 2);
    assert.equal(payload.collections["memory-active"], 1);
    assert.equal(payload.collections["memory-durable"], 1);

    const exportedFocus = await readFile(path.join(outputRoot, "memory-active", "operational", "mem_cli_focus.md"), "utf8");
    assert.ok(exportedFocus.includes("Current focus is debugging memory retrieval reliability."));
  } finally {
    if (previousRoot === undefined) {
      delete process.env.MEMORY_ROOT;
    } else {
      process.env.MEMORY_ROOT = previousRoot;
    }

    if (previousExportRoot === undefined) {
      delete process.env.MEMORY_QMD_EXPORT_ROOT;
    } else {
      process.env.MEMORY_QMD_EXPORT_ROOT = previousExportRoot;
    }
  }
});

test("getQmdMemoryPaths returns locked runtime and data paths", () => {
  const previous = {
    runtime: process.env.QMD_RUNTIME_ROOT,
    data: process.env.QMD_DATA_ROOT,
    export: process.env.QMD_EXPORT_ROOT,
    config: process.env.QMD_CONFIG_ROOT,
    index: process.env.QMD_INDEX_ROOT,
    name: process.env.QMD_INDEX_NAME
  };

  delete process.env.QMD_RUNTIME_ROOT;
  delete process.env.QMD_DATA_ROOT;
  delete process.env.QMD_EXPORT_ROOT;
  delete process.env.QMD_CONFIG_ROOT;
  delete process.env.QMD_INDEX_ROOT;
  delete process.env.QMD_INDEX_NAME;

  try {
    const paths = getQmdMemoryPaths();
    const runtimeRoot = path.join(os.homedir(), ".agent-memory", "runtime", "qmd-runtime");
    const dataRoot = path.join(os.homedir(), ".agent-memory", "runtime", "qmd-memory");
    assert.equal(paths.runtimeRoot, runtimeRoot);
    assert.equal(paths.exportRoot, path.join(dataRoot, "export"));
    assert.equal(paths.configRoot, path.join(dataRoot, "config"));
    assert.equal(paths.indexRoot, path.join(dataRoot, "index"));
    assert.equal(paths.dbPath, path.join(dataRoot, "index", "qmd", "agent-memory.sqlite"));
    assert.equal(paths.runtimeDistEntry, path.join(runtimeRoot, "dist", "index.js"));
  } finally {
    if (previous.runtime === undefined) delete process.env.QMD_RUNTIME_ROOT; else process.env.QMD_RUNTIME_ROOT = previous.runtime;
    if (previous.data === undefined) delete process.env.QMD_DATA_ROOT; else process.env.QMD_DATA_ROOT = previous.data;
    if (previous.export === undefined) delete process.env.QMD_EXPORT_ROOT; else process.env.QMD_EXPORT_ROOT = previous.export;
    if (previous.config === undefined) delete process.env.QMD_CONFIG_ROOT; else process.env.QMD_CONFIG_ROOT = previous.config;
    if (previous.index === undefined) delete process.env.QMD_INDEX_ROOT; else process.env.QMD_INDEX_ROOT = previous.index;
    if (previous.name === undefined) delete process.env.QMD_INDEX_NAME; else process.env.QMD_INDEX_NAME = previous.name;
  }
});

test("buildQmdMemoryConfig defines active durable and policy collections", () => {
  const config = buildQmdMemoryConfig(getQmdMemoryPaths());

  assert.equal(config.global_context.includes("canonical memory IDs"), true);
  assert.equal(Object.keys(config.collections).sort().join(","), "memory-active,memory-durable,memory-policy");
  assert.equal(config.collections["memory-active"].path, path.join(os.homedir(), ".agent-memory", "runtime", "qmd-memory", "export", "memory-active"));
  assert.equal(config.collections["memory-active"].pattern, "**/*.md");
  assert.equal(config.collections["memory-policy"].context?.["/"]?.includes("non-negotiable"), true);
});

test("createQmdMemoryStore fails clearly when runtime dist is not built", async () => {
  const runtimeRoot = await mkdtemp(path.join(os.tmpdir(), "agent-qmd-runtime-missing-"));
  const paths = getQmdMemoryPaths();
  const overridden = {
    ...paths,
    runtimeRoot,
    runtimeDistEntry: path.join(runtimeRoot, "dist", "index.js"),
    runtimePackageJson: path.join(runtimeRoot, "package.json"),
    runtimeNotesPath: path.join(runtimeRoot, "RUNTIME_NOTES.md")
  };

  await assert.rejects(
    () => createQmdMemoryStore(overridden),
    /QMD runtime is not built or not available/
  );
});

test("extractMemoryId prefers body metadata and falls back to filename", () => {
  assert.equal(
    extractMemoryId({
      filepath: "/home/example/.agent-memory/runtime/qmd-memory/export/memory-active/operational/mem_body.md",
      body: 'memory_id: "mem_from_body"\n'
    }),
    "mem_from_body"
  );

  assert.equal(
    extractMemoryId({
      filepath: "/home/example/.agent-memory/runtime/qmd-memory/export/memory-active/operational/mem_from_filename.md"
    }),
    "mem_from_filename"
  );
});

test("mapQmdResult maps collection and canonical memory id", () => {
  const mapped = mapQmdResult({
    filepath: "/home/example/.agent-memory/runtime/qmd-memory/export/memory-policy/policy/mem_policy_capture.md",
    displayPath: "memory-policy/policy/mem_policy_capture.md",
    title: "Interactive confirmations must autopromote.",
    context: "Normative rules",
    score: 0.91,
    snippet: "Confirmed captures should record and promote immediately."
  });

  assert.equal(mapped.memory_id, "mem_policy_capture");
  assert.equal(mapped.collection, "memory-policy");
  assert.equal(mapped.score, 0.91);

  const qmdUriMapped = mapQmdResult({
    filepath: "qmd://memory-active/operational/mem_active_capture.md?index=agent-memory",
    title: "Active capture",
    score: 0.5
  });

  assert.equal(qmdUriMapped.collection, "memory-active");
  assert.equal(qmdUriMapped.memory_id, "mem_active_capture");
});

test("bootstrapQmdMemoryIndex updates and optionally embeds via injected store", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "agent-qmd-bootstrap-"));
  const paths = {
    ...getQmdMemoryPaths(),
    runtimeRootData: tempRoot,
    exportRoot: path.join(tempRoot, "export"),
    configRoot: path.join(tempRoot, "config"),
    indexRoot: path.join(tempRoot, "index"),
    dbPath: path.join(tempRoot, "index", "agent-memory.sqlite")
  };

  const calls: string[] = [];
  const result = await bootstrapQmdMemoryIndex(
    { embed: true, forceEmbed: true, chunkStrategy: "regex" },
    {
      paths,
      createStore: async () => ({
        dbPath: paths.dbPath,
        async update() {
          calls.push("update");
          return { collections: 3, indexed: 10, updated: 2, unchanged: 16, removed: 0, needsEmbedding: 28 };
        },
        async embed() {
          calls.push("embed");
          return { docsProcessed: 28, chunksEmbedded: 28, errors: [], durationMs: 123 };
        },
        async close() {
          calls.push("close");
        }
      })
    }
  );

  assert.deepEqual(calls, ["update", "embed", "close"]);
  assert.equal(result.updated.indexed, 10);
  assert.equal(result.embedded?.chunksEmbedded, 28);
});

test("searchQmdMemory routes lex and hybrid queries through injected store", async () => {
  const paths = getQmdMemoryPaths();

  const lex = await searchQmdMemory(
    {
      query: "current focus",
      mode: "lex",
      collections: ["memory-active"],
      limit: 5
    },
    {
      paths,
      createStore: async () => ({
        dbPath: paths.dbPath,
        async searchLex() {
          return [
            {
              filepath: "/home/example/.agent-memory/runtime/qmd-memory/export/memory-active/operational/mem_focus.md",
              displayPath: "memory-active/operational/mem_focus.md",
              title: "Current focus is debugging memory retrieval reliability.",
              score: 0.8,
              context: "active memory"
            }
          ];
        },
        async searchVector() {
          return [];
        },
        async search() {
          return [];
        },
        async close() {}
      })
    }
  );

  assert.equal(lex.hits.length, 1);
  assert.equal(lex.hits[0].memory_id, "mem_focus");
  assert.equal(lex.hits[0].collection, "memory-active");

  const hybrid = await searchQmdMemory(
    {
      query: "How should memory capture work here?",
      mode: "hybrid",
      intent: "retrieve workspace policy and decisions about memory capture workflow and autopromotion",
      collections: ["memory-policy", "memory-durable"],
      rerank: false,
      limit: 5
    },
    {
      paths,
      createStore: async () => ({
        dbPath: paths.dbPath,
        async searchLex() {
          return [];
        },
        async searchVector() {
          return [];
        },
        async search() {
          return [
            {
              filepath: "/home/example/.agent-memory/runtime/qmd-memory/export/memory-policy/policy/mem_policy_capture.md",
              displayPath: "memory-policy/policy/mem_policy_capture.md",
              title: "Interactive confirmations must autopromote.",
              score: 0.93,
              context: "policy memory"
            },
            {
              filepath: "/home/example/.agent-memory/runtime/qmd-memory/export/memory-durable/decision/mem_decision.md",
              displayPath: "memory-durable/decision/mem_decision.md",
              title: "Adopted agent-mediated KB operating model.",
              score: 0.65,
              context: "durable memory"
            }
          ];
        },
        async close() {}
      })
    }
  );

  assert.equal(hybrid.hits.length, 2);
  assert.equal(hybrid.hits[0].memory_id, "mem_policy_capture");
  assert.equal(hybrid.hits[0].score > hybrid.hits[1].score, true);
});

test("resolveQmdHits maps QMD hits back to canonical memory records", async () => {
  const memoryRoot = await makeTestMemoryRoot();
  const activeItem = buildValidMemoryItem({
    id: "mem_qmd_focus",
    state: "active",
    truth_class: "operational",
    subject: "current-focus",
    summary: "Current focus is debugging memory retrieval reliability.",
    assertion: "The current active work is debugging memory retrieval reliability."
  });

  const filePath = path.join(memoryRoot, activeItem.state, activeItem.truth_class, `${activeItem.id}.json`);
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(activeItem, null, 2)}\n`, "utf8");

  const resolved = await resolveQmdHits(memoryRoot, [
    {
      memory_id: "mem_qmd_focus",
      collection: "memory-active",
      score: 0.9,
      displayPath: "memory-active/operational/mem_qmd_focus.md",
      filepath: "/tmp/memory-active/operational/mem_qmd_focus.md",
      title: activeItem.summary,
      context: "active memory",
      snippet: null
    },
    {
      memory_id: "mem_missing",
      collection: "memory-active",
      score: 0.3,
      displayPath: "memory-active/operational/mem_missing.md",
      filepath: "/tmp/memory-active/operational/mem_missing.md",
      title: "Missing",
      context: null,
      snippet: null
    }
  ]);

  assert.equal(resolved.resolved.length, 1);
  assert.equal(resolved.resolved[0].record.id, "mem_qmd_focus");
  assert.deepEqual(resolved.missing_memory_ids, ["mem_missing"]);
});

test("retrieveMemoryWithQmd returns deterministic and resolved QMD results", async () => {
  const deterministicRecords = [
    buildValidMemoryItem({
      id: "mem_det_focus",
      state: "active",
      truth_class: "operational",
      subject: "current-focus",
      summary: "Current focus is debugging memory retrieval reliability.",
      assertion: "The current active work is debugging memory retrieval reliability.",
      tags: ["current-focus"]
    }),
    buildValidMemoryItem({
      id: "mem_det_blocker",
      state: "active",
      truth_class: "operational",
      subject: "blocker",
      summary: "Blocked on retrieval semantics drift.",
      assertion: "The current blocker is retrieval semantics drift.",
      tags: ["blocker"]
    })
  ];

  const result = await retrieveMemoryWithQmd(
    {
      memoryRoot: "/tmp/unused",
      deterministicRecords,
      subjectBias: ["current-focus"],
      qmd: {
        query: "What are we focused on?",
        mode: "hybrid",
        collections: ["memory-active"],
        limit: 5
      }
    },
    {
      search: async () => ({
        paths: getQmdMemoryPaths(),
        hits: [
          {
            memory_id: "mem_qmd_focus",
            collection: "memory-active",
            score: 0.94,
            displayPath: "memory-active/operational/mem_qmd_focus.md",
            filepath: "/tmp/memory-active/operational/mem_qmd_focus.md",
            title: "Current focus is debugging memory retrieval reliability.",
            context: "active memory",
            snippet: null
          }
        ]
      }),
      resolve: async () => ({
        resolved: [
          {
            qmd: {
              memory_id: "mem_qmd_focus",
              collection: "memory-active",
              score: 0.94,
              displayPath: "memory-active/operational/mem_qmd_focus.md",
              filepath: "/tmp/memory-active/operational/mem_qmd_focus.md",
              title: "Current focus is debugging memory retrieval reliability.",
              context: "active memory",
              snippet: null
            },
            record: buildValidMemoryItem({
              id: "mem_qmd_focus",
              state: "active",
              truth_class: "operational",
              subject: "current-focus",
              summary: "Current focus is debugging memory retrieval reliability.",
              assertion: "The current active work is debugging memory retrieval reliability.",
              tags: ["current-focus"]
            })
          }
        ],
        missing_memory_ids: []
      })
    }
  );

  assert.equal(result.deterministic.length, 1);
  assert.equal(result.deterministic[0].id, "mem_det_focus");
  assert.equal(result.qmd_resolved.length, 1);
  assert.equal(result.qmd_resolved[0].record.id, "mem_qmd_focus");
});

test("buildDefaultQmdQuery routes focus prompts to memory-active without rerank", () => {
  const query = buildDefaultQmdQuery({ prompt: "What are we focused on?" });

  assert.equal(query.mode, "hybrid");
  assert.deepEqual(query.collections, ["memory-active"]);
  assert.equal(query.rerank, false);
  assert.ok(query.intent?.includes("current active operational focus"));
});

test("buildDefaultQmdQuery routes memory capture policy prompts to policy and durable collections", () => {
  const query = buildDefaultQmdQuery({ prompt: "How should memory capture work here?" });

  assert.deepEqual(query.collections, ["memory-policy", "memory-durable"]);
  assert.equal(query.rerank, false);
  assert.ok(query.intent?.includes("memory capture workflow and autopromotion"));
});

test("retrieveWithDefaultQmdRouting applies default routing and focus subject bias", async () => {
  const deterministicRecords = [
    buildValidMemoryItem({
      id: "mem_det_focus",
      state: "active",
      truth_class: "operational",
      subject: "current-focus",
      summary: "Current focus is debugging memory retrieval reliability.",
      assertion: "The current active work is debugging memory retrieval reliability.",
      tags: ["current-focus"]
    }),
    buildValidMemoryItem({
      id: "mem_det_misc",
      state: "active",
      truth_class: "operational",
      subject: null,
      summary: "Workspace docs should be updated when extensions become real capabilities.",
      assertion: "Workspace docs should be updated when implemented extensions become real environment capabilities.",
      tags: []
    })
  ];

  const result = await retrieveWithDefaultQmdRouting(
    {
      prompt: "What are we focused on?",
      memoryRoot: "/tmp/unused",
      deterministicRecords
    },
    {
      search: async (request) => ({
        paths: getQmdMemoryPaths(),
        hits: [
          {
            memory_id: "mem_qmd_focus",
            collection: "memory-active",
            score: 0.94,
            displayPath: "memory-active/operational/mem_qmd_focus.md",
            filepath: "/tmp/memory-active/operational/mem_qmd_focus.md",
            title: "Current focus is debugging memory retrieval reliability.",
            context: "active memory",
            snippet: null
          }
        ]
      }),
      resolve: async () => ({
        resolved: [
          {
            qmd: {
              memory_id: "mem_qmd_focus",
              collection: "memory-active",
              score: 0.94,
              displayPath: "memory-active/operational/mem_qmd_focus.md",
              filepath: "/tmp/memory-active/operational/mem_qmd_focus.md",
              title: "Current focus is debugging memory retrieval reliability.",
              context: "active memory",
              snippet: null
            },
            record: buildValidMemoryItem({
              id: "mem_qmd_focus",
              state: "active",
              truth_class: "operational",
              subject: "current-focus",
              summary: "Current focus is debugging memory retrieval reliability.",
              assertion: "The current active work is debugging memory retrieval reliability.",
              tags: ["current-focus"]
            })
          }
        ],
        missing_memory_ids: []
      })
    }
  );

  assert.deepEqual(result.qmd_query.collections, ["memory-active"]);
  assert.equal(result.qmd_query.rerank, false);
  assert.equal(result.deterministic.length, 1);
  assert.equal(result.deterministic[0].id, "mem_det_focus");
  assert.equal(result.qmd_resolved[0].record.id, "mem_qmd_focus");
});

test("audit-active CLI exits 0 when no attention needed", async () => {
  const memoryRoot = await makeTestMemoryRoot();
  const previousRoot = process.env.MEMORY_ROOT;
  process.env.MEMORY_ROOT = memoryRoot;

  try {
    const { result, stdout } = await captureConsole(() =>
      main(["audit-active", "--sessions-elapsed", "1", "--format", "summary"])
    );

    assert.equal(result, 0);
    const payload = JSON.parse(stdout.join("\n"));
    assert.equal(payload.needs_attention, false);
    assert.equal(payload.summary.total_active, 0);
  } finally {
    if (previousRoot === undefined) {
      delete process.env.MEMORY_ROOT;
    } else {
      process.env.MEMORY_ROOT = previousRoot;
    }
  }
});

test("session-end with nothing staged returns early cleanly", async () => {
  const memoryRoot = await makeTestMemoryRoot();
  const previousRoot = process.env.MEMORY_ROOT;
  process.env.MEMORY_ROOT = memoryRoot;

  try {
    const { result, stdout } = await captureConsole(() =>
      main(["session-end", "--session", "sess-empty"])
    );

    assert.equal(result, 0);
    const payload = JSON.parse(stdout.join("\n"));
    assert.equal(payload.staged_candidates, 0);
    assert.equal(payload.staged_events, 0);
    assert.ok(payload.note.includes("nothing staged"));
  } finally {
    if (previousRoot === undefined) {
      delete process.env.MEMORY_ROOT;
    } else {
      process.env.MEMORY_ROOT = previousRoot;
    }
  }
});

test("session-end dry-run reports staged candidates without promoting", async () => {
  const memoryRoot = await makeTestMemoryRoot();
  const previousRoot = process.env.MEMORY_ROOT;
  process.env.MEMORY_ROOT = memoryRoot;

  try {
    // Stage something via session-record
    await captureConsole(() =>
      main([
        "session-record",
        "--type", "decision",
        "--summary", "Memory engine is stable enough for production use.",
        "--workspace", "/path/to/Agent Memory Template",
        "--session", "sess-dry",
        "--tags", "decision,important"
      ])
    );

    const { result, stdout } = await captureConsole(() =>
      main(["session-end", "--session", "sess-dry", "--dry-run"])
    );

    assert.equal(result, 0);
    const payload = JSON.parse(stdout.join("\n"));
    assert.equal(payload.dry_run, true);
    assert.equal(payload.staged_candidates, 1);
    assert.ok(payload.promotable >= 1 || payload.discarded >= 1 || payload.suppressed >= 1);

    // Staging should be untouched after dry-run
    const stillStaged = await listStagedRecords(memoryRoot, "candidates");
    assert.equal(stillStaged.length, 1);
  } finally {
    if (previousRoot === undefined) {
      delete process.env.MEMORY_ROOT;
    } else {
      process.env.MEMORY_ROOT = previousRoot;
    }
  }
});

test("session-end promotes and cleans staging", async () => {
  const memoryRoot = await makeTestMemoryRoot();
  const previousRoot = process.env.MEMORY_ROOT;
  process.env.MEMORY_ROOT = memoryRoot;

  try {
    await captureConsole(() =>
      main([
        "session-record",
        "--type", "decision",
        "--summary", "Memory engine is stable enough for production use.",
        "--workspace", "/path/to/Agent Memory Template",
        "--session", "sess-live",
        "--tags", "decision,important"
      ])
    );

    const { result, stdout } = await captureConsole(() =>
      main(["session-end", "--session", "sess-live"])
    );

    assert.equal(result, 0);
    const payload = JSON.parse(stdout.join("\n"));
    assert.ok(payload.attempted >= 1);
    assert.equal(payload.failures, 0);

    // Staging should be cleared
    const remaining = await listStagedRecords(memoryRoot, "candidates");
    assert.equal(remaining.length, 0);
  } finally {
    if (previousRoot === undefined) {
      delete process.env.MEMORY_ROOT;
    } else {
      process.env.MEMORY_ROOT = previousRoot;
    }
  }
});

test("session-record stages event and candidate in one step", async () => {
  const memoryRoot = await makeTestMemoryRoot();
  const previousRoot = process.env.MEMORY_ROOT;
  process.env.MEMORY_ROOT = memoryRoot;

  try {
    const { result, stdout } = await captureConsole(() =>
      main([
        "session-record",
        "--type", "decision",
        "--summary", "Memory engine implementation is prioritized before integration work.",
        "--workspace", "/path/to/Agent Memory Template",
        "--session", "sess-test",
        "--tags", "decision,important"
      ])
    );

    assert.equal(result, 0);
    const payload = JSON.parse(stdout.join("\n"));
    assert.ok(payload.event_id.startsWith("evt_"));
    assert.ok(payload.candidate_id.startsWith("cand_"));
    assert.ok(payload.staged.event.includes("/staging/events/"));
    assert.ok(payload.staged.candidate.includes("/staging/candidates/"));

    const stagedEvents = await listStagedRecords(memoryRoot, "events");
    const stagedCandidates = await listStagedRecords(memoryRoot, "candidates");
    assert.equal(stagedEvents.length, 1);
    assert.equal(stagedCandidates.length, 1);
  } finally {
    if (previousRoot === undefined) {
      delete process.env.MEMORY_ROOT;
    } else {
      process.env.MEMORY_ROOT = previousRoot;
    }
  }
});

test("session-startup returns retrieval packet for workspace", async () => {
  const memoryRoot = await makeTestMemoryRoot();
  const candidate = deriveCandidate(
    recordEvent({
      type: "decision",
      summary: "Memory first, library later.",
      source: { kind: "session", session: "sess-1", workspace: "/path/to/Agent Memory Template" },
      tags: ["decision", "important"]
    })
  );
  await materializeCandidate(memoryRoot, { candidate, targetState: "durable", sessionId: "sess-1" });
  await loadMemoryRecords(memoryRoot);

  const previousRoot = process.env.MEMORY_ROOT;
  process.env.MEMORY_ROOT = memoryRoot;

  try {
    const { result, stdout } = await captureConsole(() =>
      main(["session-startup", "--workspace", "/path/to/Agent Memory Template", "--session", "sess-2"])
    );

    assert.equal(result, 0);
    const payload = JSON.parse(stdout.join("\n"));
    assert.equal(payload.workspace, "/path/to/Agent Memory Template");
    assert.ok(payload.resolved_scopes.includes("global"));
    assert.ok(payload.resolved_scopes.includes("workspace:/path/to/Agent Memory Template"));
    assert.ok(Array.isArray(payload.memory.durable));
  } finally {
    if (previousRoot === undefined) {
      delete process.env.MEMORY_ROOT;
    } else {
      process.env.MEMORY_ROOT = previousRoot;
    }
  }
});

test("withMemoryLock rejects concurrent mutation attempts", async () => {
  const memoryRoot = await mkdtemp(path.join(os.tmpdir(), "agent-memory-lock-"));
  const firstLock = withMemoryLock(memoryRoot, async () => {
    const lockMetadata = JSON.parse(await readFile(path.join(memoryRoot, ".locks", "memory-engine.lock"), "utf8"));
    assert.equal(lockMetadata.pid, process.pid);
    assert.equal(typeof lockMetadata.createdAt, "string");
    await new Promise((resolve) => setTimeout(resolve, 100));
    return "held";
  });

  await new Promise((resolve) => setTimeout(resolve, 10));
  await assert.rejects(() => withMemoryLock(memoryRoot, async () => "second"), /memory store is locked/);
  await firstLock;
});

test("withMemoryLock clears stale lock from dead process", async () => {
  const memoryRoot = await mkdtemp(path.join(os.tmpdir(), "agent-memory-stale-lock-"));
  const lockDir = path.join(memoryRoot, ".locks");
  const lockPath = path.join(lockDir, "memory-engine.lock");
  await mkdir(lockDir, { recursive: true });
  await writeFile(
    lockPath,
    JSON.stringify({ pid: 99999999, createdAt: new Date(Date.now() - 60_000).toISOString(), command: "dead-test" })
  );

  const result = await withMemoryLock(memoryRoot, async () => "recovered");

  assert.equal(result, "recovered");
});

test("rebuildIndexes writes manifests and lookup indexes", async () => {
  const memoryRoot = await mkdtemp(path.join(os.tmpdir(), "agent-memory-"));
  const records: LoadedMemoryRecord[] = [
    buildLoadedRecord({
      id: "mem_active_one",
      state: "active",
      truth_class: "operational",
      scope: ["workspace:/tmp/test", "repo:agent-memory"],
      subject: "focus",
      retrieval_weight: 0.95,
      summary: "Active record"
    }),
    buildLoadedRecord({
      id: "mem_durable_one",
      state: "durable",
      truth_class: "decision",
      scope: ["workspace:/tmp/test"],
      subject: "priority-order",
      retrieval_weight: 0.8,
      summary: "Durable record"
    }),
    buildLoadedRecord({
      id: "mem_suppressed_one",
      state: "suppressed",
      truth_class: "project",
      scope: ["workspace:/tmp/other"],
      subject: null,
      retrieval_weight: 0.1,
      summary: "Suppressed record"
    })
  ].map((record) => ({
    ...record,
    filePath: path.join(memoryRoot, record.item.state, record.item.truth_class, `${record.item.id}.json`),
    stateDir: record.item.state,
    truthClassDir: record.item.truth_class
  }));

  await rebuildIndexes(memoryRoot, records);

  const activeManifest = await readJson(path.join(memoryRoot, "indexes", "active-manifest.json"));
  const durableManifest = await readJson(path.join(memoryRoot, "indexes", "durable-manifest.json"));
  const suppressedManifest = await readJson(path.join(memoryRoot, "indexes", "suppressed-manifest.json"));
  const byScope = await readJson(path.join(memoryRoot, "indexes", "by-scope.json"));
  const bySubject = await readJson(path.join(memoryRoot, "indexes", "by-subject.json"));
  const byTruthClass = await readJson(path.join(memoryRoot, "indexes", "by-truth-class.json"));

  assert.equal(activeManifest.item_count, 1);
  assert.equal(activeManifest.items[0].id, "mem_active_one");
  assert.equal(durableManifest.item_count, 1);
  assert.equal(durableManifest.items[0].id, "mem_durable_one");
  assert.equal(suppressedManifest.item_count, 1);
  assert.equal(suppressedManifest.items[0].id, "mem_suppressed_one");

  assert.deepEqual(byScope.scopes["workspace:/tmp/test"], ["mem_active_one", "mem_durable_one"]);
  assert.deepEqual(byScope.scopes["workspace:/tmp/other"], ["mem_suppressed_one"]);
  assert.deepEqual(bySubject.subjects.focus, ["mem_active_one"]);
  assert.deepEqual(bySubject.subjects["priority-order"], ["mem_durable_one"]);
  assert.deepEqual(byTruthClass.truth_classes.operational, ["mem_active_one"]);
  assert.deepEqual(byTruthClass.truth_classes.decision, ["mem_durable_one"]);
  assert.deepEqual(byTruthClass.truth_classes.project, ["mem_suppressed_one"]);
});
