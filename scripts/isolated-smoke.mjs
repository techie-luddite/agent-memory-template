#!/usr/bin/env node
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const root = process.cwd();
const temp = await mkdtemp(path.join(os.tmpdir(), "agent-memory-isolated-"));
const home = path.join(temp, "home");
const memoryRoot = path.join(temp, "memory");
const env = { ...process.env, HOME: home, MEMORY_ROOT: memoryRoot };

function run(args, options = {}) {
  const result = spawnSync(process.execPath, [path.join(root, "bin", "agent-memory.mjs"), ...args], {
    cwd: root,
    env,
    encoding: "utf8"
  });
  if (result.status !== 0 && !options.allowFailure) {
    console.error(`command failed: agent-memory ${args.join(" ")}`);
    console.error(result.stdout);
    console.error(result.stderr);
    process.exit(result.status ?? 1);
  }
  return result;
}

try {
  run(["init"]);
  run(["validate"]);
  run(["doctor"]);
  run(["session-startup", "--workspace", path.join(temp, "project"), "--session", "sess-smoke", "--query", "what is the current focus?"]);
  run(["session-record", "--type", "decision", "--summary", "Use the portable agent-memory CLI for lifecycle integration.", "--workspace", path.join(temp, "project"), "--session", "sess-smoke", "--tags", "example,integration"]);
  run(["session-end", "--session", "sess-smoke"]);
  run(["validate"]);
  run(["retrieve", "--query", "portable lifecycle integration", "--scope", `workspace:${path.join(temp, "project")}`]);
  run(["packet", "--query", "portable lifecycle integration", "--workspace", path.join(temp, "project"), "--format", "markdown"]);
  console.log(JSON.stringify({ ok: true, isolated_home: home, isolated_memory_root: memoryRoot }, null, 2));
} finally {
  if (!process.env.AGENT_MEMORY_KEEP_ISOLATED_SMOKE) {
    await rm(temp, { recursive: true, force: true });
  }
}
