import { randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, stat } from "node:fs/promises";
import { isAbsolute, join, relative, resolve } from "node:path";
import { isDeepStrictEqual } from "node:util";

import { createTwoFilesPatch } from "diff";
import { z } from "zod";

import { resolveRuntimePaths } from "../paths.js";
import { validateState } from "../state/store.js";
import { TOOL_IDS } from "../types.js";
import type {
  AppState,
  FileChange,
  RuntimePaths,
  TransactionFile,
  TransactionManifest,
  TransactionStatus,
} from "../types.js";
import {
  atomicWriteFile,
  atomicWriteJson,
  ensurePrivateDirectory,
  isNotFoundError,
  readUtf8IfExists,
  sha256,
  unlinkIfExists,
} from "./fs.js";
import { withGlobalLock } from "./lock.js";
import { redactSensitiveText } from "./redaction.js";

export interface PreviewOptions {
  secrets?: readonly string[];
}

export interface FileChangePreview {
  path: string;
  description: string;
  changed: boolean;
  beforeHash: string | null;
  afterHash: string;
  diff: string;
}

interface StoredTransactionFile extends TransactionFile {
  beforeMode?: number;
  afterMode?: number;
  afterPath?: string;
}

interface StoredTransactionManifest extends TransactionManifest {
  status: TransactionStatus;
  rolledBackAt?: string;
}

interface Snapshot {
  change: FileChange;
  path: string;
  before: string | null;
  beforeMode?: number;
}

const transactionFileSchema = z.strictObject({
  path: z.string().min(1),
  existed: z.boolean(),
  beforeHash: z
    .string()
    .regex(/^[a-f0-9]{64}$/)
    .nullable(),
  afterHash: z.string().regex(/^[a-f0-9]{64}$/),
  backupPath: z.string().min(1).nullable(),
  beforeMode: z.number().int().min(0).max(0o777).optional(),
  afterMode: z.number().int().min(0).max(0o777).optional(),
  afterPath: z.string().min(1).optional(),
});

const manifestSchema = z.strictObject({
  id: z.string().regex(/^[a-zA-Z0-9._-]+$/),
  createdAt: z.iso.datetime({ offset: true }),
  files: z.array(transactionFileSchema),
  status: z.enum([
    "prepared",
    "applied",
    "failed",
    "rolling-back",
    "rolled-back",
  ]),
  rolledBackAt: z.iso.datetime({ offset: true }).optional(),
});

export class TransactionError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "TransactionError";
  }
}

export class FileChangedError extends TransactionError {
  readonly code = "KHAPIMAN_FILE_CHANGED";

  constructor(
    readonly path: string,
    phase: "apply" | "rollback",
  ) {
    super(
      phase === "apply"
        ? `File changed since preview; refusing to overwrite: ${path}`
        : `File hash no longer matches the transaction; refusing rollback: ${path}`,
    );
    this.name = "FileChangedError";
  }
}

function normalizedPath(path: string): string {
  if (path.includes("\0")) {
    throw new TransactionError("File path contains a null byte");
  }
  return resolve(path);
}

function pathKey(path: string): string {
  const normalized = normalizedPath(path);
  return process.platform === "win32" ? normalized.toLowerCase() : normalized;
}

function transactionId(): string {
  return `${new Date().toISOString().replace(/[:.]/g, "-")}-${randomUUID()}`;
}

function transactionDirectory(paths: RuntimePaths, id: string): string {
  if (!/^[a-zA-Z0-9._-]+$/.test(id) || id === "." || id === "..") {
    throw new TransactionError(`Invalid transaction ID: ${id}`);
  }
  return join(paths.backupDir, id);
}

function isWithin(parent: string, child: string): boolean {
  const relation = relative(resolve(parent), resolve(child));
  return (
    relation === "" || (!relation.startsWith("..") && !isAbsolute(relation))
  );
}

function publicManifest(
  manifest: StoredTransactionManifest,
): TransactionManifest {
  return {
    id: manifest.id,
    createdAt: manifest.createdAt,
    files: manifest.files.map(
      ({ path, existed, beforeHash, afterHash, backupPath }) => ({
        path,
        existed,
        beforeHash,
        afterHash,
        backupPath,
      }),
    ),
    status: manifest.status,
  };
}

export function previewFileChanges(
  changes: readonly FileChange[],
  options: PreviewOptions = {},
): FileChangePreview[] {
  return changes.map((change) => {
    const path = normalizedPath(change.path);
    const before = change.before ?? "";
    const patch =
      before === change.after
        ? ""
        : createTwoFilesPatch(
            path,
            path,
            before,
            change.after,
            "before",
            "after",
            {
              context: 3,
            },
          );
    return {
      path,
      description: change.description,
      changed: change.before !== change.after,
      beforeHash: change.before === null ? null : sha256(change.before),
      afterHash: sha256(change.after),
      diff: redactSensitiveText(patch, options.secrets),
    };
  });
}

async function snapshotChanges(
  changes: readonly FileChange[],
): Promise<Snapshot[]> {
  const seen = new Set<string>();
  const snapshots: Snapshot[] = [];

  for (const change of changes) {
    const path = normalizedPath(change.path);
    const key = pathKey(path);
    if (seen.has(key)) {
      throw new TransactionError(`Duplicate file in transaction: ${path}`);
    }
    seen.add(key);

    const before = await readUtf8IfExists(path);
    if (before !== change.before) {
      throw new FileChangedError(path, "apply");
    }

    let beforeMode: number | undefined;
    if (before !== null) {
      beforeMode = (await stat(path)).mode & 0o777;
    }
    snapshots.push({
      change,
      path,
      before,
      ...(beforeMode === undefined ? {} : { beforeMode }),
    });
  }
  return snapshots;
}

async function currentHash(path: string): Promise<string | null> {
  const contents = await readUtf8IfExists(path);
  return contents === null ? null : sha256(contents);
}

async function compensateApply(snapshots: readonly Snapshot[]): Promise<void> {
  for (const snapshot of [...snapshots].reverse()) {
    const intendedHash = sha256(snapshot.change.after);
    const hash = await currentHash(snapshot.path).catch(() => null);
    if (hash !== intendedHash) {
      continue;
    }
    if (snapshot.before === null) {
      await unlinkIfExists(snapshot.path);
    } else {
      await atomicWriteFile(snapshot.path, snapshot.before, {
        mode: snapshot.beforeMode ?? 0o600,
      });
    }
  }
}

async function applyUnderLock(
  changes: readonly FileChange[],
  paths: RuntimePaths,
): Promise<TransactionManifest> {
  const snapshots = (await snapshotChanges(changes)).filter(
    (snapshot) => snapshot.before !== snapshot.change.after,
  );
  const id = transactionId();
  const directory = transactionDirectory(paths, id);
  await ensurePrivateDirectory(paths.backupDir);
  await mkdir(directory, { recursive: false, mode: 0o700 });

  const files: StoredTransactionFile[] = [];
  for (const [index, snapshot] of snapshots.entries()) {
    const filePrefix = String(index).padStart(4, "0");
    let backupPath: string | null = null;
    if (snapshot.before !== null) {
      backupPath = join(directory, `${filePrefix}.before`);
      await atomicWriteFile(backupPath, snapshot.before, { mode: 0o600 });
    }
    let afterPath: string | undefined;
    if (pathKey(snapshot.path) === pathKey(paths.stateFile)) {
      afterPath = join(directory, `${filePrefix}.after`);
      await atomicWriteFile(afterPath, snapshot.change.after, { mode: 0o600 });
    }
    files.push({
      path: snapshot.path,
      existed: snapshot.before !== null,
      beforeHash: snapshot.before === null ? null : sha256(snapshot.before),
      afterHash: sha256(snapshot.change.after),
      backupPath,
      ...(snapshot.beforeMode === undefined
        ? {}
        : { beforeMode: snapshot.beforeMode }),
      afterMode: snapshot.change.mode ?? snapshot.beforeMode ?? 0o600,
      ...(afterPath === undefined ? {} : { afterPath }),
    });
  }

  const manifestPath = join(directory, "manifest.json");
  const manifest: StoredTransactionManifest = {
    id,
    createdAt: new Date().toISOString(),
    files,
    status: "prepared",
  };
  await atomicWriteJson(manifestPath, manifest, { mode: 0o600 });

  try {
    for (const [index, snapshot] of snapshots.entries()) {
      if ((await currentHash(snapshot.path)) !== files[index]?.beforeHash) {
        throw new FileChangedError(snapshot.path, "apply");
      }
      await atomicWriteFile(snapshot.path, snapshot.change.after, {
        mode: files[index]?.afterMode ?? 0o600,
      });
    }
    manifest.status = "applied";
    await atomicWriteJson(manifestPath, manifest, { mode: 0o600 });
    return publicManifest(manifest);
  } catch (error) {
    await compensateApply(snapshots).catch(() => undefined);
    manifest.status = "failed";
    await atomicWriteJson(manifestPath, manifest, { mode: 0o600 }).catch(
      () => undefined,
    );
    throw error;
  }
}

export async function applyFileChanges(
  changes: readonly FileChange[],
  paths: RuntimePaths = resolveRuntimePaths(),
): Promise<TransactionManifest> {
  return withGlobalLock(paths, () => applyUnderLock(changes, paths));
}

async function readStoredManifest(
  id: string,
  paths: RuntimePaths,
): Promise<StoredTransactionManifest> {
  const directory = transactionDirectory(paths, id);
  const manifestPath = join(directory, "manifest.json");
  let value: unknown;
  try {
    value = JSON.parse(await readFile(manifestPath, "utf8")) as unknown;
  } catch (error) {
    throw new TransactionError(`Cannot read transaction manifest: ${id}`, {
      cause: error,
    });
  }
  const parsed = manifestSchema.safeParse(value);
  if (!parsed.success || parsed.data.id !== id) {
    throw new TransactionError(`Invalid transaction manifest: ${id}`, {
      cause: parsed.success ? undefined : parsed.error,
    });
  }
  return {
    id: parsed.data.id,
    createdAt: parsed.data.createdAt,
    files: parsed.data.files.map((file) => ({
      path: file.path,
      existed: file.existed,
      beforeHash: file.beforeHash,
      afterHash: file.afterHash,
      backupPath: file.backupPath,
      ...(file.beforeMode === undefined ? {} : { beforeMode: file.beforeMode }),
      ...(file.afterMode === undefined ? {} : { afterMode: file.afterMode }),
      ...(file.afterPath === undefined ? {} : { afterPath: file.afterPath }),
    })),
    status: parsed.data.status,
    ...(parsed.data.rolledBackAt === undefined
      ? {}
      : { rolledBackAt: parsed.data.rolledBackAt }),
  };
}

export async function loadTransactionManifest(
  id: string,
  paths: RuntimePaths = resolveRuntimePaths(),
): Promise<TransactionManifest> {
  return publicManifest(await readStoredManifest(id, paths));
}

interface RollbackSnapshot {
  file: StoredTransactionFile;
  current: string | null;
  currentHash: string | null;
  restore: string | null;
  restoreHash: string | null;
}

function parseStoredState(contents: string, path: string): AppState {
  try {
    return validateState(JSON.parse(contents) as unknown);
  } catch (error) {
    throw new TransactionError(`Cannot recover KHapiMAN state: ${path}`, {
      cause: error,
    });
  }
}

function stateText(state: AppState): string {
  return `${JSON.stringify(state, null, 2)}\n`;
}

function mergeStateRollback(
  path: string,
  currentContents: string,
  beforeContents: string,
  afterContents: string,
): string {
  const current = parseStoredState(currentContents, path);
  const before = parseStoredState(beforeContents, path);
  const after = parseStoredState(afterContents, path);
  const changedTools = TOOL_IDS.filter(
    (tool) => !isDeepStrictEqual(before.bindings[tool], after.bindings[tool]),
  );
  if (changedTools.length === 0) {
    throw new FileChangedError(path, "rollback");
  }

  const restored = structuredClone(current);
  for (const tool of changedTools) {
    const currentBinding = current.bindings[tool];
    const beforeBinding = before.bindings[tool];
    const afterBinding = after.bindings[tool];
    if (isDeepStrictEqual(currentBinding, beforeBinding)) continue;
    if (!isDeepStrictEqual(currentBinding, afterBinding)) {
      throw new FileChangedError(path, "rollback");
    }
    if (beforeBinding === undefined) {
      delete restored.bindings[tool];
    } else {
      restored.bindings[tool] = beforeBinding;
    }
  }

  validateState(restored);
  return isDeepStrictEqual(restored, current)
    ? currentContents
    : stateText(restored);
}

async function readBackup(
  file: StoredTransactionFile,
  directory: string,
): Promise<string | null> {
  if (!file.existed) {
    if (file.backupPath !== null || file.beforeHash !== null) {
      throw new TransactionError(`Invalid new-file backup for: ${file.path}`);
    }
    return null;
  }
  if (
    file.backupPath === null ||
    file.beforeHash === null ||
    !isWithin(directory, file.backupPath)
  ) {
    throw new TransactionError(`Unsafe backup path for: ${file.path}`);
  }
  let backup: string;
  try {
    backup = await readFile(file.backupPath, "utf8");
  } catch (error) {
    throw new TransactionError(`Cannot read backup for: ${file.path}`, {
      cause: error,
    });
  }
  if (sha256(backup) !== file.beforeHash) {
    throw new TransactionError(`Backup hash mismatch for: ${file.path}`);
  }
  return backup;
}

async function readStateAfter(
  file: StoredTransactionFile,
  directory: string,
): Promise<string | null> {
  if (file.afterPath === undefined) return null;
  if (!isWithin(directory, file.afterPath)) {
    throw new TransactionError(`Unsafe after-state path for: ${file.path}`);
  }
  let after: string;
  try {
    after = await readFile(file.afterPath, "utf8");
  } catch (error) {
    throw new TransactionError(`Cannot read after-state for: ${file.path}`, {
      cause: error,
    });
  }
  if (sha256(after) !== file.afterHash) {
    throw new TransactionError(`After-state hash mismatch for: ${file.path}`);
  }
  return after;
}

async function prepareRollbackSnapshots(
  manifest: StoredTransactionManifest,
  paths: RuntimePaths,
): Promise<RollbackSnapshot[]> {
  const directory = transactionDirectory(paths, manifest.id);
  const snapshots: RollbackSnapshot[] = [];
  for (const file of manifest.files) {
    const current = await readUtf8IfExists(file.path);
    const hash = current === null ? null : sha256(current);
    const backup = await readBackup(file, directory);
    let restore = backup;

    if (
      pathKey(file.path) === pathKey(paths.stateFile) &&
      current !== null &&
      backup !== null
    ) {
      const after = await readStateAfter(file, directory);
      if (after !== null) {
        restore = mergeStateRollback(file.path, current, backup, after);
      } else if (hash !== file.afterHash && hash !== file.beforeHash) {
        throw new FileChangedError(file.path, "rollback");
      }
    } else if (hash !== file.afterHash && hash !== file.beforeHash) {
      throw new FileChangedError(file.path, "rollback");
    }

    snapshots.push({
      file,
      current,
      currentHash: hash,
      restore,
      restoreHash: restore === null ? null : sha256(restore),
    });
  }
  return snapshots;
}

async function restoreUnderLock(
  id: string,
  paths: RuntimePaths,
  recoveryOnly: boolean,
): Promise<TransactionManifest> {
  const manifest = await readStoredManifest(id, paths);
  if (manifest.status === "rolled-back") return publicManifest(manifest);
  if (recoveryOnly && manifest.status === "applied") {
    throw new TransactionError(
      `Transaction ${id} is applied; use rollback instead of recovery`,
    );
  }

  const directory = transactionDirectory(paths, id);
  const snapshots = await prepareRollbackSnapshots(manifest, paths);
  const previousStatus = manifest.status;
  manifest.status = "rolling-back";
  delete manifest.rolledBackAt;
  await atomicWriteJson(join(directory, "manifest.json"), manifest, {
    mode: 0o600,
  });

  const restored: RollbackSnapshot[] = [];
  try {
    for (const snapshot of [...snapshots].reverse()) {
      if ((await currentHash(snapshot.file.path)) !== snapshot.currentHash) {
        throw new FileChangedError(snapshot.file.path, "rollback");
      }
      if (snapshot.currentHash === snapshot.restoreHash) continue;
      if (snapshot.restore === null) {
        await unlinkIfExists(snapshot.file.path);
      } else {
        await atomicWriteFile(snapshot.file.path, snapshot.restore, {
          mode: snapshot.file.beforeMode ?? 0o600,
        });
      }
      restored.push(snapshot);
    }
  } catch (error) {
    let compensated = true;
    for (const snapshot of restored.reverse()) {
      if ((await currentHash(snapshot.file.path)) !== snapshot.restoreHash) {
        compensated = false;
        continue;
      }
      try {
        if (snapshot.current === null) {
          await unlinkIfExists(snapshot.file.path);
        } else {
          await atomicWriteFile(snapshot.file.path, snapshot.current, {
            mode: snapshot.file.afterMode ?? 0o600,
          });
        }
      } catch {
        compensated = false;
      }
    }
    if (compensated) {
      manifest.status = previousStatus;
      await atomicWriteJson(join(directory, "manifest.json"), manifest, {
        mode: 0o600,
      }).catch(() => undefined);
    }
    throw error;
  }

  manifest.status = "rolled-back";
  manifest.rolledBackAt = new Date().toISOString();
  await atomicWriteJson(join(directory, "manifest.json"), manifest, {
    mode: 0o600,
  });
  return publicManifest(manifest);
}

export async function rollbackTransaction(
  id: string,
  paths: RuntimePaths = resolveRuntimePaths(),
): Promise<TransactionManifest> {
  return withGlobalLock(paths, () => restoreUnderLock(id, paths, false));
}

export async function recoverTransaction(
  id: string,
  paths: RuntimePaths = resolveRuntimePaths(),
): Promise<TransactionManifest> {
  return withGlobalLock(paths, () => restoreUnderLock(id, paths, true));
}

export async function listTransactions(
  paths: RuntimePaths = resolveRuntimePaths(),
): Promise<TransactionManifest[]> {
  let entries;
  try {
    entries = await readdir(paths.backupDir, { withFileTypes: true });
  } catch (error) {
    if (isNotFoundError(error)) {
      return [];
    }
    throw error;
  }

  const manifests = await Promise.all(
    entries
      .filter((entry) => entry.isDirectory())
      .map(async (entry) => {
        try {
          return await readStoredManifest(entry.name, paths);
        } catch {
          return null;
        }
      }),
  );
  return manifests
    .filter(
      (manifest): manifest is StoredTransactionManifest =>
        manifest !== null && manifest.status !== "rolled-back",
    )
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
    .map(publicManifest);
}

export class TransactionEngine {
  constructor(private readonly paths: RuntimePaths = resolveRuntimePaths()) {}

  preview(
    changes: readonly FileChange[],
    options: PreviewOptions = {},
  ): FileChangePreview[] {
    return previewFileChanges(changes, options);
  }

  async apply(changes: readonly FileChange[]): Promise<TransactionManifest> {
    return applyFileChanges(changes, this.paths);
  }

  async rollback(id: string): Promise<TransactionManifest> {
    return rollbackTransaction(id, this.paths);
  }

  async recover(id: string): Promise<TransactionManifest> {
    return recoverTransaction(id, this.paths);
  }

  async list(): Promise<TransactionManifest[]> {
    return listTransactions(this.paths);
  }
}
