import { randomUUID } from "node:crypto";
import { open, readFile, unlink } from "node:fs/promises";
import { dirname } from "node:path";

import type { RuntimePaths } from "../types.js";
import { ensurePrivateDirectory, isNotFoundError } from "./fs.js";

interface LockRecord {
  pid: number;
  acquiredAt: string;
  token: string;
}

export class FileLockError extends Error {
  readonly code = "KHAPIMAN_LOCKED";

  constructor(readonly lockPath: string) {
    super(`Another KHapiMAN operation holds the lock: ${lockPath}`);
    this.name = "FileLockError";
  }
}

export interface FileLock {
  readonly path: string;
  release(): Promise<void>;
}

function isAlreadyExistsError(error: unknown): boolean {
  return (
    error instanceof Error &&
    "code" in error &&
    (error as NodeJS.ErrnoException).code === "EEXIST"
  );
}

function processIsAlive(pid: number): boolean {
  if (!Number.isSafeInteger(pid) || pid <= 0) {
    return false;
  }

  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (
      error instanceof Error &&
      "code" in error &&
      (error as NodeJS.ErrnoException).code === "EPERM"
    );
  }
}

async function removeAbandonedLock(path: string): Promise<boolean> {
  let raw: string;
  try {
    raw = await readFile(path, "utf8");
  } catch (error) {
    if (isNotFoundError(error)) {
      return true;
    }
    return false;
  }

  let record: LockRecord;
  try {
    record = JSON.parse(raw) as LockRecord;
  } catch {
    return false;
  }

  if (processIsAlive(record.pid)) {
    return false;
  }

  try {
    if ((await readFile(path, "utf8")) !== raw) {
      return false;
    }
    await unlink(path);
    return true;
  } catch (error) {
    return isNotFoundError(error);
  }
}

async function acquireReclamationGuard(path: string): Promise<FileLock | null> {
  const guardPath = `${path}.reclaim`;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const token = randomUUID();
    let handle;
    try {
      handle = await open(guardPath, "wx", 0o600);
      await handle.writeFile(
        `${JSON.stringify({
          pid: process.pid,
          acquiredAt: new Date().toISOString(),
          token,
        })}\n`,
      );
      await handle.sync();
    } catch (error) {
      await handle?.close().catch(() => undefined);
      if (handle) await unlink(guardPath).catch(() => undefined);
      if (isAlreadyExistsError(error)) {
        if (attempt === 0 && (await removeAbandonedLock(guardPath))) continue;
        return null;
      }
      throw error;
    }

    let released = false;
    return {
      path: guardPath,
      async release() {
        if (released) return;
        released = true;
        await handle.close();
        try {
          const current = JSON.parse(
            await readFile(guardPath, "utf8"),
          ) as LockRecord;
          if (current.token === token) {
            await unlink(guardPath);
          }
        } catch (error) {
          if (!isNotFoundError(error)) throw error;
        }
      },
    };
  }
  return null;
}

async function createOwnedLock(path: string): Promise<FileLock> {
  const token = randomUUID();
  const handle = await open(path, "wx", 0o600);
  const record: LockRecord = {
    pid: process.pid,
    acquiredAt: new Date().toISOString(),
    token,
  };
  try {
    await handle.writeFile(`${JSON.stringify(record)}\n`);
    await handle.sync();
  } catch (error) {
    await handle.close().catch(() => undefined);
    await unlink(path).catch(() => undefined);
    throw error;
  }

  let released = false;
  return {
    path,
    async release() {
      if (released) return;
      released = true;
      await handle.close();

      try {
        const current = JSON.parse(await readFile(path, "utf8")) as LockRecord;
        if (current.token === token) {
          await unlink(path);
        }
      } catch (error) {
        if (!isNotFoundError(error)) throw error;
      }
    },
  };
}

export async function acquireFileLock(path: string): Promise<FileLock> {
  await ensurePrivateDirectory(dirname(path));

  try {
    return await createOwnedLock(path);
  } catch (error) {
    if (!isAlreadyExistsError(error)) throw error;
  }

  const guard = await acquireReclamationGuard(path);
  if (guard === null) throw new FileLockError(path);
  try {
    if (!(await removeAbandonedLock(path))) {
      throw new FileLockError(path);
    }
  } finally {
    await guard.release();
  }

  try {
    return await createOwnedLock(path);
  } catch (error) {
    if (isAlreadyExistsError(error)) throw new FileLockError(path);
    throw error;
  }
}

export async function withFileLock<T>(
  path: string,
  operation: () => Promise<T>,
): Promise<T> {
  const lock = await acquireFileLock(path);
  try {
    return await operation();
  } finally {
    await lock.release();
  }
}

export async function withGlobalLock<T>(
  paths: RuntimePaths,
  operation: () => Promise<T>,
): Promise<T> {
  return withFileLock(paths.lockFile, operation);
}
