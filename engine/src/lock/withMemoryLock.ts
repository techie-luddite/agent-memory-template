import { mkdir, open, readFile, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";

const STALE_UNKNOWN_LOCK_MS = 5 * 60 * 1000;

type LockMetadata = {
  pid: number;
  createdAt: string;
  command?: string;
};

function isErrno(error: unknown, code: string): boolean {
  return typeof error === "object" && error !== null && "code" in error && (error as { code?: string }).code === code;
}

function isProcessAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) {
    return false;
  }

  try {
    process.kill(pid, 0);
    return true;
  } catch (error: unknown) {
    if (isErrno(error, "ESRCH")) {
      return false;
    }
    if (isErrno(error, "EPERM")) {
      return true;
    }
    return true;
  }
}

async function readLockMetadata(lockPath: string): Promise<LockMetadata | null> {
  try {
    const raw = await readFile(lockPath, "utf8");
    if (raw.trim().length === 0) {
      return null;
    }

    const parsed = JSON.parse(raw) as Partial<LockMetadata>;
    const pid = parsed.pid;
    const createdAt = parsed.createdAt;
    if (typeof pid !== "number" || !Number.isInteger(pid) || typeof createdAt !== "string") {
      return null;
    }

    return {
      pid,
      createdAt,
      command: typeof parsed.command === "string" ? parsed.command : undefined
    };
  } catch {
    return null;
  }
}

async function removeStaleLockIfSafe(lockPath: string): Promise<boolean> {
  const metadata = await readLockMetadata(lockPath);

  if (metadata !== null) {
    if (isProcessAlive(metadata.pid)) {
      return false;
    }

    await rm(lockPath, { force: true });
    return true;
  }

  const stats = await stat(lockPath).catch(() => null);
  if (stats === null) {
    return true;
  }

  const ageMs = Date.now() - stats.mtimeMs;
  if (ageMs >= STALE_UNKNOWN_LOCK_MS) {
    await rm(lockPath, { force: true });
    return true;
  }

  return false;
}

async function describeLock(lockPath: string): Promise<string> {
  const metadata = await readLockMetadata(lockPath);
  if (metadata === null) {
    return lockPath;
  }

  return `${lockPath} (pid ${metadata.pid}, created ${metadata.createdAt}${metadata.command ? `, command ${metadata.command}` : ""})`;
}

export async function withMemoryLock<T>(memoryRoot: string, task: () => Promise<T>): Promise<T> {
  const lockDir = path.join(memoryRoot, ".locks");
  const lockPath = path.join(lockDir, "memory-engine.lock");

  await mkdir(lockDir, { recursive: true });

  let handle;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      handle = await open(lockPath, "wx");
      break;
    } catch (error: unknown) {
      if (!isErrno(error, "EEXIST")) {
        throw error;
      }

      const removed = await removeStaleLockIfSafe(lockPath);
      if (!removed || attempt === 1) {
        throw new Error(`memory store is locked by another mutation: ${await describeLock(lockPath)}`);
      }
    }
  }

  if (handle === undefined) {
    throw new Error(`memory store is locked by another mutation: ${await describeLock(lockPath)}`);
  }

  try {
    const metadata: LockMetadata = {
      pid: process.pid,
      createdAt: new Date().toISOString(),
      command: process.argv.join(" ")
    };
    await writeFile(handle, `${JSON.stringify(metadata, null, 2)}\n`, "utf8");

    return await task();
  } finally {
    await handle.close();
    await rm(lockPath, { force: true });
  }
}
