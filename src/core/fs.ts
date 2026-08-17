import { createHash, randomUUID } from "node:crypto";
import {
  chmod,
  lstat,
  mkdir,
  open,
  readFile,
  rename,
  stat,
  unlink,
} from "node:fs/promises";
import { basename, dirname, join } from "node:path";

export interface AtomicWriteOptions {
  mode?: number;
}

export class UnsafeFileTypeError extends Error {
  readonly code = "KHAPIMAN_UNSAFE_FILE_TYPE";

  constructor(readonly path: string) {
    super(`Refusing to replace a symbolic link: ${path}`);
    this.name = "UnsafeFileTypeError";
  }
}

export function sha256(value: string | Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}

export async function ensurePrivateDirectory(path: string): Promise<void> {
  await mkdir(path, { recursive: true, mode: 0o700 });
  if (process.platform !== "win32") {
    await chmod(path, 0o700);
  }
}

export async function readUtf8IfExists(path: string): Promise<string | null> {
  try {
    return await readFile(path, "utf8");
  } catch (error) {
    if (isNotFoundError(error)) {
      return null;
    }
    throw error;
  }
}

export async function pathExists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch (error) {
    if (isNotFoundError(error)) {
      return false;
    }
    throw error;
  }
}

export async function atomicWriteFile(
  path: string,
  contents: string | Buffer,
  options: AtomicWriteOptions = {},
): Promise<void> {
  const parent = dirname(path);
  // Existing config directories may intentionally be shared; only newly created
  // directories receive the private default from mkdir.
  await mkdir(parent, { recursive: true, mode: 0o700 });

  await assertSafeAtomicTarget(path);

  let mode = options.mode;
  if (mode === undefined) {
    try {
      mode = (await stat(path)).mode & 0o777;
    } catch (error) {
      if (!isNotFoundError(error)) {
        throw error;
      }
      mode = 0o600;
    }
  }

  const temporaryPath = join(
    parent,
    `.${basename(path)}.${process.pid}.${randomUUID()}.tmp`,
  );
  let handle;

  try {
    handle = await open(temporaryPath, "wx", mode);
    await handle.writeFile(contents);
    await handle.sync();
    await handle.close();
    handle = undefined;
    await assertSafeAtomicTarget(path);
    await rename(temporaryPath, path);
    await chmod(path, mode);
  } catch (error) {
    if (handle !== undefined) {
      await handle.close().catch(() => undefined);
    }
    await unlink(temporaryPath).catch(() => undefined);
    throw error;
  }
}

async function assertSafeAtomicTarget(path: string): Promise<void> {
  try {
    if ((await lstat(path)).isSymbolicLink()) {
      throw new UnsafeFileTypeError(path);
    }
  } catch (error) {
    if (!isNotFoundError(error)) {
      throw error;
    }
  }
}

export async function atomicWriteJson(
  path: string,
  value: unknown,
  options: AtomicWriteOptions = {},
): Promise<void> {
  await atomicWriteFile(path, `${JSON.stringify(value, null, 2)}\n`, options);
}

export async function unlinkIfExists(path: string): Promise<boolean> {
  try {
    await unlink(path);
    return true;
  } catch (error) {
    if (isNotFoundError(error)) {
      return false;
    }
    throw error;
  }
}

export function isNotFoundError(error: unknown): boolean {
  return (
    error instanceof Error &&
    "code" in error &&
    (error as NodeJS.ErrnoException).code === "ENOENT"
  );
}
