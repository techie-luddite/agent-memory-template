#!/usr/bin/env node
import { cp, mkdir, readdir, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const repoRoot = path.resolve(path.dirname(__filename), "..");
const engineEntry = path.join(repoRoot, "engine", "dist", "src", "cli.js");
const exampleSchemas = path.join(repoRoot, "examples", "memory-store", "schemas");

function memoryRoot() {
  return process.env.MEMORY_ROOT ?? path.join(os.homedir(), ".agent-memory", "memory");
}

async function exists(target) {
  try {
    await stat(target);
    return true;
  } catch {
    return false;
  }
}

async function initMemoryRoot(args) {
  const root = path.resolve(args[0] ?? memoryRoot());
  const dirs = [
    "active/preference",
    "active/environment",
    "active/project",
    "active/operational",
    "active/relationship",
    "active/policy",
    "active/decision",
    "durable/preference",
    "durable/environment",
    "durable/project",
    "durable/operational",
    "durable/relationship",
    "durable/policy",
    "durable/decision",
    "suppressed/preference",
    "suppressed/environment",
    "suppressed/project",
    "suppressed/operational",
    "suppressed/relationship",
    "suppressed/policy",
    "suppressed/decision",
    "staging/events",
    "staging/candidates",
    "indexes",
    "schemas"
  ];

  for (const dir of dirs) {
    await mkdir(path.join(root, dir), { recursive: true });
  }

  if (!(await exists(exampleSchemas))) {
    console.error(`schema source not found: ${exampleSchemas}`);
    console.error("Run `npm run build` from the repository root before initializing a memory store.");
    return 1;
  }

  await cp(exampleSchemas, path.join(root, "schemas"), { recursive: true, force: true });
  const schemas = await readdir(path.join(root, "schemas"));

  console.log(JSON.stringify({
    ok: true,
    memory_root: root,
    schemas: schemas.sort(),
    note: "initialized memory store; set MEMORY_ROOT to this path or rely on the default ~/.agent-memory/memory"
  }, null, 2));
  return 0;
}

async function main() {
  const [command, ...rest] = process.argv.slice(2);

  if (command === "init") {
    return initMemoryRoot(rest);
  }

  if (command === "version" || command === "--version" || command === "-v") {
    const pkg = await import(pathToFileURL(path.join(repoRoot, "package.json")).href, { with: { type: "json" } });
    console.log(pkg.default.version);
    return 0;
  }

  if (!(await exists(engineEntry))) {
    console.error(`built engine not found: ${engineEntry}`);
    console.error("Run `npm run build` from the repository root first.");
    return 1;
  }

  const cli = await import(pathToFileURL(engineEntry).href);
  return cli.main(process.argv.slice(2));
}

main().then((code) => process.exit(code)).catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exit(1);
});
