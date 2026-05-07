import os from "node:os";
import path from "node:path";
import { access, readdir, readFile } from "node:fs/promises";
import { loadMemoryRecords } from "./load/loadMemoryRecords.js";
import { withMemoryLock } from "./lock/withMemoryLock.js";
import { createMemoryItemValidator, validateMemoryCorpus, validateMemoryItem } from "./validate/validateMemoryItem.js";
import { matchScopes } from "./scopes/matchScopes.js";
import { buildRetrievalSet } from "./retrieval/buildRetrievalSet.js";
import { auditActiveMemory } from "./audit/auditActiveMemory.js";
import { exportQmd } from "./export/exportQmd.js";
import { retrieveWithDefaultQmdRouting } from "./qmd/retrieveWithDefaultQmdRouting.js";
import { explainRetrieval } from "./explain/explainRetrieval.js";
import { deriveSessionScopes } from "./session/deriveSessionScopes.js";
import { explainReconciliation } from "./explain/explainReconciliation.js";
import { explainPromotion } from "./explain/explainPromotion.js";
import { buildRetrievalPacket } from "./packets/buildRetrievalPacket.js";
import { rebuildIndexes } from "./indexes/rebuildIndexes.js";
import {
  createMemoryEventValidator,
  recordEvent,
  validateMemoryEvent,
  type MemoryEvent,
  type MemoryEventType
} from "./events/recordEvent.js";
import {
  createMemoryCandidateValidator,
  deriveCandidate,
  primarySourceEventId,
  validateMemoryCandidate,
  type MemoryCandidate
} from "./candidates/deriveCandidate.js";
import { evaluatePromotion } from "./promotion/evaluatePromotion.js";
import { evaluateSuppression } from "./suppression/evaluateSuppression.js";
import {
  reconcileAndMaterializeCandidate,
  reconcileCandidateAgainstExisting,
  type MaterializedMemoryRecord
} from "./materialize/materializeCandidate.js";
import {
  deleteStagedRecord,
  listStagedRecords,
  readStagedRecord,
  writeStagedRecord
} from "./staging/stagingStore.js";
import { buildStagedStatusReport } from "./staging/buildStagedStatus.js";
import type { LoadedMemoryRecord, MemoryState } from "./types/MemoryItem.js";

function getMemoryRoot(): string {
  return process.env.MEMORY_ROOT ?? path.join(os.homedir(), ".agent-memory", "memory");
}

function getQmdExportRoot(): string {
  return process.env.MEMORY_QMD_EXPORT_ROOT ?? path.join(os.homedir(), ".agent-memory", "runtime", "qmd-memory", "export");
}

function parseFlag(args: string[], name: string): string | undefined {
  const index = args.indexOf(name);
  if (index === -1) return undefined;
  return args[index + 1];
}

function parseListFlag(args: string[], name: string): string[] {
  const value = parseFlag(args, name) ?? "";
  return value
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
}

async function parseJsonFlag<T>(args: string[], inlineFlag: string, fileFlag: string): Promise<T | undefined> {
  const inline = parseFlag(args, inlineFlag);
  if (inline) {
    return JSON.parse(inline) as T;
  }

  const filePath = parseFlag(args, fileFlag);
  if (!filePath) return undefined;
  return JSON.parse(await readFile(filePath, "utf8")) as T;
}

async function collectValidationErrors(root: string, records: LoadedMemoryRecord[], loadErrors: string[]): Promise<string[]> {
  const validator = await createMemoryItemValidator(root);
  const validationErrors = [...loadErrors];

  for (const record of records) {
    const errors = validateMemoryItem(record, validator);
    if (errors.length > 0) {
      validationErrors.push(`${record.filePath}: ${errors.join(", ")}`);
    }
  }

  validationErrors.push(...validateMemoryCorpus(records));
  return validationErrors;
}

async function validateCommand(): Promise<number> {
  const root = getMemoryRoot();
  const { records, errors: loadErrors } = await loadMemoryRecords(root);
  const validationErrors = await collectValidationErrors(root, records, loadErrors);

  for (const error of validationErrors) {
    console.error(error);
  }

  console.log(`validated ${records.length} memory records from ${root}`);
  if (validationErrors.length > 0) {
    console.error(`validation failed with ${validationErrors.length} error(s)`);
    return 1;
  }

  console.log("validation passed");
  return 0;
}

async function indexCommand(): Promise<number> {
  const root = getMemoryRoot();
  return withMemoryLock(root, async () => {
    const { records, errors: loadErrors } = await loadMemoryRecords(root);
    const validationErrors = await collectValidationErrors(root, records, loadErrors);

    if (validationErrors.length > 0) {
      for (const error of validationErrors) {
        console.error(error);
      }
      console.error(`indexing aborted due to ${validationErrors.length} validation error(s)`);
      return 1;
    }

    await rebuildIndexes(root, records);
    console.log(`rebuilt indexes for ${records.length} memory records from ${root}`);
    return 0;
  });
}

async function pathExists(target: string): Promise<boolean> {
  try {
    await access(target);
    return true;
  } catch {
    return false;
  }
}

async function doctorCommand(): Promise<number> {
  const root = getMemoryRoot();
  const requiredSchemas = [
    "candidate.schema.json",
    "event.schema.json",
    "memory-item.schema.json",
    "retrieval-packet.schema.json"
  ];
  const requiredDirs = [
    "active",
    "durable",
    "suppressed",
    "staging/events",
    "staging/candidates",
    "schemas",
    "indexes"
  ];
  const indexFiles = [
    "active-manifest.json",
    "durable-manifest.json",
    "suppressed-manifest.json",
    "by-scope.json",
    "by-subject.json",
    "by-truth-class.json"
  ];

  const missingDirs: string[] = [];
  for (const dir of requiredDirs) {
    if (!(await pathExists(path.join(root, dir)))) missingDirs.push(dir);
  }

  const missingSchemas: string[] = [];
  for (const schema of requiredSchemas) {
    if (!(await pathExists(path.join(root, "schemas", schema)))) missingSchemas.push(schema);
  }

  const missingIndexes: string[] = [];
  for (const indexFile of indexFiles) {
    if (!(await pathExists(path.join(root, "indexes", indexFile)))) missingIndexes.push(indexFile);
  }

  const { records, errors: loadErrors } = await loadMemoryRecords(root);
  const validationErrors = missingSchemas.length === 0
    ? await collectValidationErrors(root, records, loadErrors)
    : [...loadErrors, ...missingSchemas.map((schema) => `missing schema: ${schema}`)];

  const stagedEvents = await readdir(path.join(root, "staging", "events")).catch(() => []);
  const stagedCandidates = await readdir(path.join(root, "staging", "candidates")).catch(() => []);
  const qmdRuntimeRoot = process.env.QMD_RUNTIME_ROOT ?? path.join(os.homedir(), ".agent-memory", "runtime", "qmd-runtime");

  const checks = {
    memory_root_exists: await pathExists(root),
    required_directories_present: missingDirs.length === 0,
    schemas_present: missingSchemas.length === 0,
    corpus_valid: validationErrors.length === 0,
    indexes_present: missingIndexes.length === 0,
    qmd_runtime_present: await pathExists(qmdRuntimeRoot)
  };

  const warnings = [
    ...(missingIndexes.length > 0 ? [`indexes missing or incomplete: ${missingIndexes.join(", ")}; run agent-memory index`] : []),
    ...(stagedCandidates.length > 0 ? [`${stagedCandidates.length} staged candidate(s) waiting for review/promotion`] : []),
    ...(!checks.qmd_runtime_present ? ["optional QMD runtime not found; qmd-retrieve will be unavailable unless configured"] : [])
  ];

  const errors = [
    ...(missingDirs.length > 0 ? [`missing required directories: ${missingDirs.join(", ")}; run agent-memory init`] : []),
    ...(missingSchemas.length > 0 ? [`missing required schemas: ${missingSchemas.join(", ")}; run agent-memory init`] : []),
    ...validationErrors
  ];

  console.log(JSON.stringify({
    ok: errors.length === 0,
    memory_root: root,
    checks,
    counts: {
      records: records.length,
      staged_events: stagedEvents.filter((name) => name.endsWith(".json")).length,
      staged_candidates: stagedCandidates.filter((name) => name.endsWith(".json")).length
    },
    warnings,
    errors
  }, null, 2));

  return errors.length === 0 ? 0 : 1;
}

function renderPacketMarkdown(packet: ReturnType<typeof buildRetrievalPacket>): string {
  const lines: string[] = [];
  lines.push("# Agent memory packet");
  lines.push("");
  lines.push(`Query: ${packet.query || "(none)"}`);
  lines.push("");
  lines.push("## Scope");
  lines.push(...(packet.scope.length > 0 ? packet.scope.map((scope) => `- ${scope}`) : ["- global / unspecified"]));

  const section = (title: string, items: typeof packet.active) => {
    lines.push("");
    lines.push(`## ${title}`);
    if (items.length === 0) {
      lines.push("- none");
      return;
    }
    for (const item of items) {
      lines.push(`- ${item.summary}`);
      lines.push(`  - id: ${item.id}`);
      lines.push(`  - truth_class: ${item.truth_class}`);
      if (item.subject) lines.push(`  - subject: ${item.subject}`);
      lines.push(`  - scope: ${item.scope.join(", ") || "none"}`);
    }
  };

  section("Active", packet.active);
  section("Durable", packet.durable);
  section("Policies", packet.policies);

  if (packet.notes) {
    lines.push("");
    lines.push("## Notes");
    lines.push(packet.notes);
  }

  return `${lines.join("\n")}\n`;
}

async function packetCommand(args: string[]): Promise<number> {
  const root = getMemoryRoot();
  const workspace = parseFlag(args, "--workspace") ?? null;
  const query = parseFlag(args, "--query") ?? "";
  const extraScopes = parseListFlag(args, "--extra-scopes");
  const format = parseFlag(args, "--format") ?? "json";
  const limit = parseInt(parseFlag(args, "--limit") ?? "8", 10);
  const activeLimit = parseInt(parseFlag(args, "--active-limit") ?? "4", 10);
  const durableLimit = parseInt(parseFlag(args, "--durable-limit") ?? "4", 10);
  const policyLimit = parseInt(parseFlag(args, "--policy-limit") ?? "3", 10);

  if (!["json", "markdown", "md"].includes(format)) {
    console.error("packet --format must be one of: json, markdown");
    return 1;
  }

  const scopes = deriveSessionScopes({ workspace, extraScopes });
  const { records, errors } = await loadMemoryRecords(root);
  if (errors.length > 0) {
    for (const error of errors) console.error(error);
    console.error(`packet aborted due to ${errors.length} load error(s)`);
    return 1;
  }

  const filtered = records
    .map((record) => record.item)
    .filter((record) => matchScopes(record.scope, scopes));

  const retrievalSet = buildRetrievalSet(filtered, {
    limit,
    activeLimit,
    durableLimit,
    policyLimit,
    requestedScopes: scopes,
    query,
    includeSuppressed: false
  });

  const packet = buildRetrievalPacket(query, scopes, retrievalSet);
  console.log(format === "json" ? JSON.stringify(packet, null, 2) : renderPacketMarkdown(packet));
  return 0;
}

async function retrieveCommand(args: string[]): Promise<number> {
  const root = getMemoryRoot();
  const query = parseFlag(args, "--query") ?? "";
  const scopeArg = parseFlag(args, "--scope") ?? "";
  const requestedScopes = scopeArg ? scopeArg.split(",").map((s) => s.trim()).filter(Boolean) : [];
  const includeSuppressed = args.includes("--include-suppressed");
  const { records, errors } = await loadMemoryRecords(root);

  if (errors.length > 0) {
    for (const error of errors) {
      console.error(error);
    }
    console.error(`retrieval aborted due to ${errors.length} load error(s)`);
    return 1;
  }

  const filtered = records
    .map((record) => record.item)
    .filter((record) => (requestedScopes.length > 0 ? matchScopes(record.scope, requestedScopes) : true));

  const retrievalSet = buildRetrievalSet(filtered, {
    limit: 8,
    activeLimit: 4,
    durableLimit: 4,
    policyLimit: 3,
    requestedScopes,
    query,
    includeSuppressed
  });
  const packet = buildRetrievalPacket(query, requestedScopes, retrievalSet);
  console.log(JSON.stringify(packet, null, 2));
  return 0;
}

async function sessionStartupCommand(args: string[]): Promise<number> {
  const root = getMemoryRoot();
  const workspace = parseFlag(args, "--workspace") ?? null;
  const sessionId = parseFlag(args, "--session") ?? null;
  const query = parseFlag(args, "--query") ?? "";
  const extraScopes = parseListFlag(args, "--extra-scopes");
  const limit = parseInt(parseFlag(args, "--limit") ?? "8", 10);
  const activeLimit = parseInt(parseFlag(args, "--active-limit") ?? "4", 10);
  const durableLimit = parseInt(parseFlag(args, "--durable-limit") ?? "4", 10);
  const policyLimit = parseInt(parseFlag(args, "--policy-limit") ?? "3", 10);

  const scopes = deriveSessionScopes({ workspace, extraScopes });

  const { records, errors } = await loadMemoryRecords(root);
  if (errors.length > 0) {
    for (const error of errors) console.error(error);
    console.error(`session-startup aborted due to ${errors.length} load error(s)`);
    return 1;
  }

  const filtered = records
    .map((record) => record.item)
    .filter((record) => matchScopes(record.scope, scopes));

  const retrievalSet = buildRetrievalSet(filtered, {
    limit,
    activeLimit,
    durableLimit,
    policyLimit,
    requestedScopes: scopes,
    query,
    includeSuppressed: false
  });

  const packet = buildRetrievalPacket(query, scopes, retrievalSet);

  console.log(
    JSON.stringify(
      {
        session_id: sessionId,
        workspace,
        resolved_scopes: scopes,
        memory: packet
      },
      null,
      2
    )
  );
  return 0;
}

async function sessionRecordCommand(args: string[]): Promise<number> {
  const root = getMemoryRoot();
  const type = parseFlag(args, "--type") as MemoryEventType | undefined;
  const summary = parseFlag(args, "--summary");
  const workspace = parseFlag(args, "--workspace") ?? null;
  const sessionId = parseFlag(args, "--session") ?? null;
  const tags = parseListFlag(args, "--tags");
  const details = await parseJsonFlag<object | unknown[] | string | null>(args, "--details-json", "--details-file");
  const noStage = args.includes("--no-stage");

  if (!type || !summary) {
    console.error("session-record requires --type and --summary");
    return 1;
  }

  const event = recordEvent({
    type,
    summary,
    source: {
      kind: "session",
      session: sessionId,
      workspace
    },
    details: details ?? null,
    tags
  });

  const eventValidator = await createMemoryEventValidator(root);
  const eventErrors = validateMemoryEvent(event, eventValidator);
  if (eventErrors.length > 0) {
    console.error(eventErrors.join("\n"));
    return 1;
  }

  const candidate = deriveCandidate(event);
  const candidateValidator = await createMemoryCandidateValidator(root);
  const candidateErrors = validateMemoryCandidate(candidate, candidateValidator);
  if (candidateErrors.length > 0) {
    console.error(candidateErrors.join("\n"));
    return 1;
  }

  if (noStage) {
    console.log(JSON.stringify({ event, candidate, staged: null }, null, 2));
    return 0;
  }

  const [stagedEvent, stagedCandidate] = await Promise.all([
    writeStagedRecord(root, "events", event.id, event),
    writeStagedRecord(root, "candidates", candidate.id, candidate)
  ]);

  console.log(
    JSON.stringify(
      {
        event_id: event.id,
        candidate_id: candidate.id,
        staged: {
          event: stagedEvent.filePath,
          candidate: stagedCandidate.filePath
        }
      },
      null,
      2
    )
  );
  return 0;
}

async function qmdRetrieveCommand(args: string[]): Promise<number> {
  const root = getMemoryRoot();
  const prompt = parseFlag(args, "--prompt");
  if (!prompt) {
    console.error("qmd-retrieve requires --prompt <text>");
    return 1;
  }

  const includeRerank = args.includes("--rerank");
  const limitRaw = parseFlag(args, "--limit");
  const limit = limitRaw ? parseInt(limitRaw, 10) : undefined;

  const { records, errors } = await loadMemoryRecords(root);
  if (errors.length > 0) {
    for (const error of errors) console.error(error);
    console.error(`qmd-retrieve aborted due to ${errors.length} load error(s)`);
    return 1;
  }

  try {
    const result = await retrieveWithDefaultQmdRouting({
      prompt,
      memoryRoot: root,
      deterministicRecords: records.map((record) => record.item),
      overrideQmd: {
        ...(includeRerank ? { rerank: true } : {}),
        ...(limit ? { limit } : {})
      }
    });

    console.log(JSON.stringify(
      {
        prompt,
        qmd_query: result.qmd_query,
        deterministic: result.deterministic.map((record) => ({
          id: record.id,
          state: record.state,
          truth_class: record.truth_class,
          subject: record.subject ?? null,
          summary: record.summary,
          scope: record.scope,
          status: record.status
        })),
        qmd_resolved: result.qmd_resolved.map((hit) => ({
          memory_id: hit.record.id,
          state: hit.record.state,
          truth_class: hit.record.truth_class,
          subject: hit.record.subject ?? null,
          summary: hit.record.summary,
          scope: hit.record.scope,
          status: hit.record.status,
          score: hit.qmd.score,
          collection: hit.qmd.collection
        })),
        missing_memory_ids: result.missing_memory_ids
      },
      null,
      2
    ));
    return 0;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`qmd-retrieve failed: ${message}`);
    return 1;
  }
}

async function exportQmdCommand(args: string[]): Promise<number> {
  const root = getMemoryRoot();
  const outputRoot = parseFlag(args, "--output-root") ?? getQmdExportRoot();
  const includeSuppressed = args.includes("--include-suppressed");
  const dryRun = args.includes("--dry-run");

  const { records, errors } = await loadMemoryRecords(root);
  if (errors.length > 0) {
    for (const error of errors) console.error(error);
    console.error(`export-qmd aborted due to ${errors.length} load error(s)`);
    return 1;
  }

  const result = await exportQmd(records, {
    outputRoot,
    includeSuppressed,
    dryRun
  });

  console.log(JSON.stringify(result, null, 2));
  return 0;
}

async function auditActiveCommand(args: string[]): Promise<number> {
  const root = getMemoryRoot();
  const sessionsRaw = parseFlag(args, "--sessions-elapsed");
  const interactionsRaw = parseFlag(args, "--interactions-elapsed");
  const format = (parseFlag(args, "--format") ?? "full") as "summary" | "full";

  const sessionsSinceReinforcement = sessionsRaw !== undefined ? parseInt(sessionsRaw, 10) : null;
  const interactionsSinceReinforcement = interactionsRaw !== undefined ? parseInt(interactionsRaw, 10) : null;

  const { records, errors } = await loadMemoryRecords(root);
  if (errors.length > 0) {
    for (const error of errors) console.error(error);
    console.error(`audit-active aborted due to ${errors.length} load error(s)`);
    return 1;
  }

  const audit = auditActiveMemory(records, {
    sessionsSinceReinforcement: sessionsSinceReinforcement ?? undefined,
    interactionsSinceReinforcement: interactionsSinceReinforcement ?? undefined
  });

  if (format === "summary") {
    console.log(JSON.stringify({ options: audit.options, summary: audit.summary, needs_attention: audit.needs_attention }, null, 2));
  } else {
    console.log(JSON.stringify(audit, null, 2));
  }

  return audit.needs_attention ? 1 : 0;
}

async function sessionEndCommand(args: string[]): Promise<number> {
  const root = getMemoryRoot();
  const sessionId = parseFlag(args, "--session") ?? null;
  const dryRun = args.includes("--dry-run");

  const stagedCandidates = await listStagedRecords<MemoryCandidate>(root, "candidates");
  const stagedEvents = await listStagedRecords<MemoryEvent>(root, "events");

  if (stagedCandidates.length === 0 && stagedEvents.length === 0) {
    console.log(
      JSON.stringify(
        {
          session_id: sessionId,
          dry_run: dryRun,
          staged_candidates: 0,
          staged_events: 0,
          promoted: 0,
          failures: 0,
          index_rebuilt: false,
          note: "nothing staged — no action taken"
        },
        null,
        2
      )
    );
    return 0;
  }

  // Collect staged state with promotion evaluation for summary
  const staged = await collectStagedState(root);
  const report = buildStagedStatusReport(staged);

  if (dryRun) {
    console.log(
      JSON.stringify(
        {
          session_id: sessionId,
          dry_run: true,
          staged_candidates: report.summary.candidate_count,
          staged_events: report.summary.event_count,
          promotable: report.summary.promotable_candidates,
          suppressed: report.summary.suppressed_candidates,
          discarded: report.summary.discarded_candidates,
          invalid: report.summary.invalid_candidates,
          candidates: report.candidates.map((c) => ({
            id: c.id,
            promotion_target: c.promotion?.target ?? null,
            promotion_reasons: c.promotion?.reasons ?? [],
            suppression: c.suppression?.suppress ?? false,
            validation_errors: c.validation_errors
          }))
        },
        null,
        2
      )
    );
    return 0;
  }

  // Execute promotion
  const promotionArgs = ["--delete-staged"];
  if (sessionId) promotionArgs.push("--session", sessionId);
  const exitCode = await promoteAllStagedCandidatesCommand(promotionArgs);
  return exitCode;
}

async function explainRetrievalCommand(args: string[]): Promise<number> {
  const root = getMemoryRoot();
  const query = parseFlag(args, "--query") ?? "";
  const scopeArg = parseFlag(args, "--scope") ?? "";
  const requestedScopes = scopeArg ? scopeArg.split(",").map((s) => s.trim()).filter(Boolean) : [];
  const includeSuppressed = args.includes("--include-suppressed");
  const limit = parseInt(parseFlag(args, "--limit") ?? "8", 10);
  const activeLimit = parseInt(parseFlag(args, "--active-limit") ?? "4", 10);
  const durableLimit = parseInt(parseFlag(args, "--durable-limit") ?? "4", 10);
  const policyLimit = parseInt(parseFlag(args, "--policy-limit") ?? "3", 10);

  const { records, errors } = await loadMemoryRecords(root);
  if (errors.length > 0) {
    for (const error of errors) console.error(error);
    console.error(`explain-retrieval aborted due to ${errors.length} load error(s)`);
    return 1;
  }

  const filtered = records
    .map((record) => record.item)
    .filter((record) => (requestedScopes.length > 0 ? matchScopes(record.scope, requestedScopes) : true));

  const explanation = explainRetrieval(filtered, {
    limit,
    activeLimit,
    durableLimit,
    policyLimit,
    requestedScopes,
    query,
    includeSuppressed
  });

  console.log(JSON.stringify(explanation, null, 2));
  return 0;
}

async function explainPromotionCommand(args: string[]): Promise<number> {
  const root = getMemoryRoot();
  const stagedCandidateId = parseFlag(args, "--staged-id");
  const candidate = stagedCandidateId
    ? (await readStagedRecord<MemoryCandidate>(root, "candidates", stagedCandidateId)).payload
    : await parseJsonFlag<MemoryCandidate>(args, "--candidate-json", "--candidate-file");

  if (!candidate) {
    console.error("explain-promotion requires --candidate-json, --candidate-file, or --staged-id");
    return 1;
  }

  const explanation = explainPromotion(candidate);
  console.log(JSON.stringify(explanation, null, 2));
  return 0;
}

async function explainReconciliationCommand(args: string[]): Promise<number> {
  const root = getMemoryRoot();
  const stagedCandidateId = parseFlag(args, "--staged-id");
  const candidate = stagedCandidateId
    ? (await readStagedRecord<MemoryCandidate>(root, "candidates", stagedCandidateId)).payload
    : await parseJsonFlag<MemoryCandidate>(args, "--candidate-json", "--candidate-file");

  if (!candidate) {
    console.error("explain-reconciliation requires --candidate-json, --candidate-file, or --staged-id");
    return 1;
  }

  const { records, errors } = await loadMemoryRecords(root);
  if (errors.length > 0) {
    for (const error of errors) console.error(error);
    console.error(`explain-reconciliation aborted due to ${errors.length} load error(s)`);
    return 1;
  }

  const explanation = explainReconciliation(candidate, records);
  console.log(JSON.stringify(explanation, null, 2));
  return 0;
}

async function recordEventCommand(args: string[]): Promise<number> {
  const root = getMemoryRoot();
  const type = parseFlag(args, "--type") as MemoryEventType | undefined;
  const summary = parseFlag(args, "--summary");
  const sourceKind = parseFlag(args, "--source-kind") ?? "session";
  const session = parseFlag(args, "--session") ?? null;
  const workspace = parseFlag(args, "--workspace") ?? null;
  const files = parseListFlag(args, "--files");
  const tags = parseListFlag(args, "--tags");
  const details = await parseJsonFlag<object | unknown[] | string | null>(args, "--details-json", "--details-file");

  if (!type || !summary) {
    console.error("record-event requires --type and --summary");
    return 1;
  }

  const event = recordEvent({
    type,
    summary,
    source: {
      kind: sourceKind,
      session,
      workspace,
      files
    },
    details: details ?? null,
    tags
  });

  const validator = await createMemoryEventValidator(root);
  const errors = validateMemoryEvent(event, validator);
  if (errors.length > 0) {
    console.error(errors.join("\n"));
    return 1;
  }

  const shouldWrite = args.includes("--write");
  const staged = shouldWrite ? await writeStagedRecord(root, "events", event.id, event) : null;

  console.log(
    JSON.stringify(
      {
        event,
        staged: staged ? { file: staged.filePath } : null
      },
      null,
      2
    )
  );
  return 0;
}

async function deriveCandidateCommand(args: string[]): Promise<number> {
  const root = getMemoryRoot();
  const stagedEventId = parseFlag(args, "--staged-event-id");
  const event = stagedEventId
    ? (await readStagedRecord<MemoryEvent>(root, "events", stagedEventId)).payload
    : await parseJsonFlag<MemoryEvent>(args, "--event-json", "--event-file");
  if (!event) {
    console.error("derive-candidate requires --event-json, --event-file, or --staged-event-id");
    return 1;
  }

  const eventValidator = await createMemoryEventValidator(root);
  const eventErrors = validateMemoryEvent(event, eventValidator);
  if (eventErrors.length > 0) {
    console.error(eventErrors.join("\n"));
    return 1;
  }

  const candidate = deriveCandidate(event);
  const candidateValidator = await createMemoryCandidateValidator(root);
  const candidateErrors = validateMemoryCandidate(candidate, candidateValidator);
  if (candidateErrors.length > 0) {
    console.error(candidateErrors.join("\n"));
    return 1;
  }

  const shouldWrite = args.includes("--write");
  const staged = shouldWrite ? await writeStagedRecord(root, "candidates", candidate.id, candidate) : null;

  console.log(
    JSON.stringify(
      {
        candidate,
        staged: staged ? { file: staged.filePath } : null
      },
      null,
      2
    )
  );
  return 0;
}

async function evaluateCandidateDecision(root: string, candidate: MemoryCandidate) {
  const candidateValidator = await createMemoryCandidateValidator(root);
  const candidateErrors = validateMemoryCandidate(candidate, candidateValidator);
  if (candidateErrors.length > 0) {
    throw new Error(candidateErrors.join("\n"));
  }

  const suppression = evaluateSuppression(candidate);
  const promotion = suppression.suppress
    ? { target: "suppressed" as const, reasons: suppression.reasons }
    : evaluatePromotion(candidate);

  return { suppression, promotion };
}

function resolvePromotionTarget(input: {
  candidateId: string;
  promotion: { target: "active" | "durable" | "suppressed" | "discard"; reasons: string[] };
  suppression: { suppress: boolean; reasons: string[] };
  forceTarget?: MemoryState;
  force?: boolean;
}): { target?: MemoryState; warnings: string[] } {
  const { candidateId, promotion, suppression, forceTarget, force = false } = input;
  const warnings: string[] = [];

  if (!forceTarget) {
    return {
      target: promotion.target === "discard" ? undefined : promotion.target,
      warnings
    };
  }

  if ((suppression.suppress || promotion.target === "discard") && !force) {
    const disposition = suppression.suppress ? "suppression" : "discard";
    throw new Error(
      `candidate ${candidateId} requires --force to override ${disposition}: ${promotion.reasons.join(", ")}`
    );
  }

  if (forceTarget !== promotion.target) {
    warnings.push(`forced target '${forceTarget}' overrides evaluated target '${promotion.target}'`);
  }

  if (suppression.suppress) {
    warnings.push(`forced promotion bypassed suppression: ${suppression.reasons.join(", ")}`);
  } else if (promotion.target === "discard") {
    warnings.push(`forced promotion bypassed discard recommendation: ${promotion.reasons.join(", ")}`);
  }

  return {
    target: forceTarget,
    warnings
  };
}

async function evaluateCandidateCommand(args: string[]): Promise<number> {
  const candidate = await parseJsonFlag<MemoryCandidate>(args, "--candidate-json", "--candidate-file");
  if (!candidate) {
    console.error("evaluate-candidate requires --candidate-json or --candidate-file");
    return 1;
  }

  const root = getMemoryRoot();

  try {
    const { suppression, promotion } = await evaluateCandidateDecision(root, candidate);
    console.log(
      JSON.stringify(
        {
          candidate_id: candidate.id,
          suppression,
          promotion
        },
        null,
        2
      )
    );
    return 0;
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    return 1;
  }
}

async function listStagedCommand(kind: "events" | "candidates"): Promise<number> {
  const root = getMemoryRoot();
  const records = await listStagedRecords(root, kind);
  console.log(
    JSON.stringify(
      {
        kind,
        count: records.length,
        items: records.map((record) => ({
          id: record.id,
          file: record.filePath
        }))
      },
      null,
      2
    )
  );
  return 0;
}

async function collectStagedState(root: string) {
  const stagedEvents = await listStagedRecords<MemoryEvent>(root, "events");
  const stagedCandidates = await listStagedRecords<MemoryCandidate>(root, "candidates");
  const eventValidator = await createMemoryEventValidator(root);
  const candidateValidator = await createMemoryCandidateValidator(root);
  const eventIds = new Set(stagedEvents.map((record) => record.id));

  const evaluatedEvents = stagedEvents.map((record) => ({
    ...record,
    validationErrors: validateMemoryEvent(record.payload, eventValidator)
  }));

  const evaluatedCandidates = [];
  for (const record of stagedCandidates) {
    const validationErrors = validateMemoryCandidate(record.payload, candidateValidator);
    const sourceEventId = primarySourceEventId(record.payload);
    const sourceEventPresent = eventIds.has(sourceEventId);

    let suppression: { suppress: boolean; reasons: string[] } | null = null;
    let promotion: { target: "active" | "durable" | "suppressed" | "discard"; reasons: string[] } | null = null;
    if (validationErrors.length === 0) {
      const evaluated = await evaluateCandidateDecision(root, record.payload);
      suppression = evaluated.suppression;
      promotion = evaluated.promotion;
    }

    evaluatedCandidates.push({
      ...record,
      validationErrors,
      sourceEventPresent,
      suppression,
      promotion
    });
  }

  return {
    events: evaluatedEvents,
    candidates: evaluatedCandidates
  };
}

async function validateStagedCommand(): Promise<number> {
  const root = getMemoryRoot();
  const staged = await collectStagedState(root);
  const errors: string[] = [];

  for (const record of staged.events) {
    for (const error of record.validationErrors) {
      errors.push(`${record.filePath}: ${error}`);
    }
  }

  for (const record of staged.candidates) {
    for (const error of record.validationErrors) {
      errors.push(`${record.filePath}: ${error}`);
    }
  }

  console.log(
    JSON.stringify(
      {
        events: staged.events.length,
        candidates: staged.candidates.length,
        valid: errors.length === 0,
        errors
      },
      null,
      2
    )
  );

  return errors.length === 0 ? 0 : 1;
}

async function stagedStatusCommand(): Promise<number> {
  const root = getMemoryRoot();
  const staged = await collectStagedState(root);
  const report = buildStagedStatusReport(staged);
  console.log(JSON.stringify(report, null, 2));
  return 0;
}

function toLoadedMemoryRecord(root: string, materialized: MaterializedMemoryRecord): LoadedMemoryRecord {
  return {
    item: materialized.item,
    filePath: materialized.filePath,
    stateDir: materialized.item.state,
    truthClassDir: materialized.item.truth_class
  };
}

function previewMaterializedPath(root: string, candidate: MemoryCandidate, targetState: MemoryState): string {
  return path.join(root, targetState, candidate.truth_class, `${candidate.id.replace(/^cand_/, "mem_")}.json`);
}

function mergeMaterializedRecords(
  existingRecords: LoadedMemoryRecord[],
  materialized: MaterializedMemoryRecord,
  superseded?: MaterializedMemoryRecord
): LoadedMemoryRecord[] {
  const replaceableIds = new Set([materialized.item.id, ...(superseded ? [superseded.item.id] : [])]);
  const nextRecords = existingRecords.filter((record) => !replaceableIds.has(record.item.id));

  if (superseded) {
    nextRecords.push(toLoadedMemoryRecord("", superseded));
  }
  nextRecords.push(toLoadedMemoryRecord("", materialized));

  return nextRecords;
}

async function promoteAllStagedCandidatesCommand(args: string[]): Promise<number> {
  const root = getMemoryRoot();
  const stagedCandidates = await listStagedRecords<MemoryCandidate>(root, "candidates");
  const deleteStaged = args.includes("--delete-staged");
  const dryRun = args.includes("--dry-run");
  const sessionId = parseFlag(args, "--session") ?? null;

  const run = async (): Promise<number> => {
    const results: Array<Record<string, unknown>> = [];
    let failures = 0;

    const existingLoad = await loadMemoryRecords(root);
    let existingRecords = existingLoad.records;
    if (existingLoad.errors.length > 0) {
      console.log(
        JSON.stringify(
          {
            attempted: stagedCandidates.length,
            failures: stagedCandidates.length,
            index_rebuilt: false,
            validation_errors: existingLoad.errors,
            results: stagedCandidates.map((record) => ({
              candidate_id: record.id,
              ok: false,
              error: `load errors before promotion: ${existingLoad.errors.join("; ")}`
            }))
          },
          null,
          2
        )
      );
      return 1;
    }

    for (const record of stagedCandidates) {
      try {
        const sourceEventId = primarySourceEventId(record.payload);
        const sourceEvent = (await readStagedRecord<MemoryEvent>(root, "events", sourceEventId)).payload;
        const { suppression, promotion } = await evaluateCandidateDecision(root, record.payload);
        const target = promotion.target === "discard" ? undefined : promotion.target;

        if (!target) {
          failures += 1;
          results.push({
            candidate_id: record.id,
            ok: false,
            error: `candidate should not be materialized: ${promotion.reasons.join(", ")}`
          });
          continue;
        }

        const decision = reconcileCandidateAgainstExisting(record.payload, existingRecords);

        if (dryRun) {
          results.push({
            candidate_id: record.id,
            ok: true,
            dry_run: true,
            suppression,
            promotion,
            reconciliation: {
              action: decision.action,
              existing_id: decision.existing?.item.id ?? null,
              reason: decision.reason,
              score: decision.score ?? null
            },
            materialized_id: record.payload.id.replace(/^cand_/, "mem_"),
            planned_file: previewMaterializedPath(root, record.payload, target)
          });
          continue;
        }

        const reconciliation = await reconcileAndMaterializeCandidate(
          root,
          {
            candidate: record.payload,
            targetState: target,
            sourceEvent,
            sessionId
          },
          existingRecords
        );
        existingRecords = mergeMaterializedRecords(existingRecords, reconciliation.materialized, reconciliation.superseded);

        if (deleteStaged) {
          await deleteStagedRecord(root, "candidates", record.id);
          await deleteStagedRecord(root, "events", sourceEventId);
        }

        results.push({
          candidate_id: record.id,
          ok: true,
          suppression,
          promotion,
          reconciliation: {
            action: reconciliation.decision.action,
            existing_id: reconciliation.decision.existing?.item.id ?? null
          },
          materialized_id: reconciliation.materialized.item.id
        });
      } catch (error) {
        failures += 1;
        results.push({
          candidate_id: record.id,
          ok: false,
          error: error instanceof Error ? error.message : String(error)
        });
      }
    }

    const validationErrors = dryRun ? [] : await (async () => {
      const { records, errors: loadErrors } = await loadMemoryRecords(root);
      return collectValidationErrors(root, records, loadErrors);
    })();
    if (!dryRun && validationErrors.length === 0) {
      const { records } = await loadMemoryRecords(root);
      await rebuildIndexes(root, records);
    }

    console.log(
      JSON.stringify(
        {
          attempted: stagedCandidates.length,
          failures,
          dry_run: dryRun,
          index_rebuilt: dryRun ? false : validationErrors.length === 0,
          validation_errors: validationErrors,
          results
        },
        null,
        2
      )
    );

    return failures === 0 && validationErrors.length === 0 ? 0 : 1;
  };

  return dryRun ? await run() : await withMemoryLock(root, run);
}

async function deleteStagedCommand(args: string[]): Promise<number> {
  const root = getMemoryRoot();
  const kind = parseFlag(args, "--kind") as "events" | "candidates" | undefined;
  const id = parseFlag(args, "--id");

  if (!kind || !id) {
    console.error("delete-staged requires --kind <events|candidates> and --id <id>");
    return 1;
  }

  return withMemoryLock(root, async () => {
    await deleteStagedRecord(root, kind, id);
    console.log(JSON.stringify({ deleted: { kind, id } }, null, 2));
    return 0;
  });
}

async function promoteCandidateCommand(args: string[]): Promise<number> {
  const root = getMemoryRoot();
  const stagedCandidateId = parseFlag(args, "--staged-id");
  const candidate = stagedCandidateId
    ? (await readStagedRecord<MemoryCandidate>(root, "candidates", stagedCandidateId)).payload
    : await parseJsonFlag<MemoryCandidate>(args, "--candidate-json", "--candidate-file");
  const stagedEventId = parseFlag(args, "--staged-event-id");
  const sourceEvent = stagedEventId
    ? (await readStagedRecord<MemoryEvent>(root, "events", stagedEventId)).payload
    : await parseJsonFlag<MemoryEvent>(args, "--event-json", "--event-file");
  const forceTarget = parseFlag(args, "--target") as MemoryState | undefined;
  const force = args.includes("--force");
  const dryRun = args.includes("--dry-run");
  const sessionId = parseFlag(args, "--session") ?? null;
  const skipIndex = args.includes("--skip-index");
  const deleteStaged = args.includes("--delete-staged");

  if (!candidate) {
    console.error("promote-candidate requires --candidate-json, --candidate-file, or --staged-id");
    return 1;
  }

  try {
    const run = async (): Promise<number> => {
      const { suppression, promotion } = await evaluateCandidateDecision(root, candidate);
      const { target, warnings } = resolvePromotionTarget({
        candidateId: candidate.id,
        promotion,
        suppression,
        forceTarget,
        force
      });

      if (!target) {
        console.error(`candidate ${candidate.id} should not be materialized: ${promotion.reasons.join(", ")}`);
        return 1;
      }

      const { records: existingRecords, errors: existingLoadErrors } = await loadMemoryRecords(root);
      if (existingLoadErrors.length > 0) {
        for (const error of existingLoadErrors) {
          console.error(error);
        }
        console.error(`promotion aborted due to ${existingLoadErrors.length} load error(s)`);
        return 1;
      }

      const decision = reconcileCandidateAgainstExisting(candidate, existingRecords);

      if (dryRun) {
        console.log(
          JSON.stringify(
            {
              candidate_id: candidate.id,
              dry_run: true,
              suppression,
              promotion,
              reconciliation: {
                action: decision.action,
                reason: decision.reason,
                existing_id: decision.existing?.item.id ?? null,
                score: decision.score ?? null
              },
              warnings,
              materialized: {
                id: candidate.id.replace(/^cand_/, "mem_"),
                state: target,
                truth_class: candidate.truth_class,
                file: previewMaterializedPath(root, candidate, target)
              },
              superseded: decision.action === "supersede" && decision.existing
                ? {
                    id: decision.existing.item.id,
                    state: "suppressed",
                    status: "superseded"
                  }
                : null,
              staged_deleted: null
            },
            null,
            2
          )
        );
        return 0;
      }

      const reconciliation = await reconcileAndMaterializeCandidate(
        root,
        {
          candidate,
          targetState: target,
          sourceEvent,
          sessionId
        },
        existingRecords
      );

      if (!skipIndex) {
        const { records, errors: loadErrors } = await loadMemoryRecords(root);
        const validationErrors = await collectValidationErrors(root, records, loadErrors);
        if (validationErrors.length > 0) {
          for (const error of validationErrors) {
            console.error(error);
          }
          console.error(`post-materialization validation failed with ${validationErrors.length} error(s)`);
          return 1;
        }
        await rebuildIndexes(root, records);
      }

      if (deleteStaged && stagedCandidateId) {
        await deleteStagedRecord(root, "candidates", stagedCandidateId);
      }
      if (deleteStaged && stagedEventId) {
        await deleteStagedRecord(root, "events", stagedEventId);
      }

      console.log(
        JSON.stringify(
          {
            candidate_id: candidate.id,
            suppression,
            promotion,
            reconciliation: {
              action: reconciliation.decision.action,
              reason: reconciliation.decision.reason,
              existing_id: reconciliation.decision.existing?.item.id ?? null,
              score: reconciliation.decision.score ?? null
            },
            warnings,
            materialized: {
              id: reconciliation.materialized.item.id,
              state: reconciliation.materialized.item.state,
              truth_class: reconciliation.materialized.item.truth_class,
              file: reconciliation.materialized.filePath
            },
            superseded: reconciliation.superseded
              ? {
                  id: reconciliation.superseded.item.id,
                  state: reconciliation.superseded.item.state,
                  status: reconciliation.superseded.item.status,
                  file: reconciliation.superseded.filePath
                }
              : null,
            staged_deleted: deleteStaged
              ? {
                  candidate: stagedCandidateId ?? null,
                  event: stagedEventId ?? null
                }
              : null
          },
          null,
          2
        )
      );
      return 0;
    };

    return dryRun ? await run() : await withMemoryLock(root, run);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    return 1;
  }
}

export async function main(args: string[] = process.argv.slice(2)): Promise<number> {
  const command = args[0] ?? "help";
  const rest = args.slice(1);

  switch (command) {
    case "validate":
      return validateCommand();
    case "index":
      return indexCommand();
    case "retrieve":
      return retrieveCommand(rest);
    case "packet":
      return packetCommand(rest);
    case "doctor":
      return doctorCommand();
    case "session-startup":
      return sessionStartupCommand(rest);
    case "session-record":
      return sessionRecordCommand(rest);
    case "session-end":
      return sessionEndCommand(rest);
    case "export-qmd":
      return exportQmdCommand(rest);
    case "qmd-retrieve":
      return qmdRetrieveCommand(rest);
    case "audit-active":
      return auditActiveCommand(rest);
    case "explain-retrieval":
      return explainRetrievalCommand(rest);
    case "explain-reconciliation":
      return explainReconciliationCommand(rest);
    case "explain-promotion":
      return explainPromotionCommand(rest);
    case "record-event":
      return recordEventCommand(rest);
    case "derive-candidate":
      return deriveCandidateCommand(rest);
    case "evaluate-candidate":
      return evaluateCandidateCommand(rest);
    case "list-staged-events":
      return listStagedCommand("events");
    case "list-staged-candidates":
      return listStagedCommand("candidates");
    case "validate-staged":
      return validateStagedCommand();
    case "staged-status":
      return stagedStatusCommand();
    case "delete-staged":
      return deleteStagedCommand(rest);
    case "promote-candidate":
      return promoteCandidateCommand(rest);
    case "promote-all-staged-candidates":
      return promoteAllStagedCandidatesCommand(rest);
    default:
      console.log(
        [
          "memory-engine commands:",
          "",
          "  corpus management:",
          "    validate",
          "    index",
          "    doctor",
          "",
          "  retrieval:",
          "    retrieve [--query <text>] [--scope <a,b,c>] [--include-suppressed]",
          "    packet [--query <text>] [--workspace <path>] [--extra-scopes <a,b>] [--format json|markdown]",
          "",
          "  explainability:",
          "    explain-retrieval [--query <text>] [--scope <a,b,c>] [--include-suppressed] [--limit n] [--active-limit n] [--durable-limit n] [--policy-limit n]",
          "    explain-reconciliation [--candidate-json <json> | --candidate-file <path> | --staged-id <id>]",
          "    explain-promotion [--candidate-json <json> | --candidate-file <path> | --staged-id <id>]",
          "",
          "  events and candidates:",
          "    record-event --type <type> --summary <text> [--source-kind <kind>] [--workspace <path>] [--session <id>] [--files a,b] [--tags a,b] [--details-json <json>] [--details-file <path>] [--write]",
          "    derive-candidate [--event-json <json> | --event-file <path> | --staged-event-id <id>] [--write]",
          "    evaluate-candidate [--candidate-json <json> | --candidate-file <path>]",
          "",
          "  staging:",
          "    list-staged-events",
          "    list-staged-candidates",
          "    validate-staged",
          "    staged-status",
          "    delete-staged --kind <events|candidates> --id <id>",
          "",
          "  maintenance:",
          "    audit-active [--sessions-elapsed <n>] [--interactions-elapsed <n>] [--format summary|full]",
          "    export-qmd [--output-root <path>] [--include-suppressed] [--dry-run]",
          "    qmd-retrieve --prompt <text> [--rerank] [--limit <n>]",
          "",
          "  session:",
          "    session-startup [--workspace <path>] [--session <id>] [--query <text>] [--extra-scopes <a,b>]",
          "    session-record --type <type> --summary <text> [--workspace <path>] [--session <id>] [--tags a,b] [--details-json <json>] [--no-stage]",
          "    session-end [--session <id>] [--dry-run]",
          "",
          "  promotion:",
          "    promote-candidate [--candidate-json <json> | --candidate-file <path> | --staged-id <id>] [--event-json <json> | --event-file <path> | --staged-event-id <id>] [--target <active|durable|suppressed>] [--force] [--dry-run] [--session <id>] [--skip-index] [--delete-staged]",
          "    promote-all-staged-candidates [--session <id>] [--delete-staged] [--dry-run]"
        ].join("\n")
      );
      console.log(`default memory root: ${path.normalize(getMemoryRoot())}`);
      return 0;
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().then((code) => process.exit(code));
}
