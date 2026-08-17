import { randomBytes, randomUUID } from "node:crypto";
import { chmod, readFile } from "node:fs/promises";

import { z } from "zod";

import { LEGACY_SECRET_SERVICE, SECRET_SERVICE } from "../constants.js";
import { atomicWriteJson, isNotFoundError } from "../core/fs.js";
import { withFileLock } from "../core/lock.js";
import {
  getSecretLockFile,
  getSecretsFile,
  resolveRuntimePaths,
} from "../paths.js";
import type { RuntimePaths } from "../types.js";

export type SecretBackend = "keyring" | "file";

export interface SecretBackendStatus {
  backend: SecretBackend;
  secure: boolean;
  warning?: string;
  path?: string;
}

export interface SecretStore {
  readonly status: SecretBackendStatus;
  get(secretId: string): Promise<string | undefined>;
  set(secretId: string, value: string): Promise<void>;
  delete(secretId: string): Promise<boolean>;
}

interface KeyringEntryLike {
  setPassword(password: string): void;
  getPassword(): string | null;
  deleteCredential(): boolean;
}

export interface KeyringModuleLike {
  Entry: new (service: string, username: string) => KeyringEntryLike;
}

export interface CreateSecretStoreOptions {
  paths?: RuntimePaths;
  keyringModule?: KeyringModuleLike | null;
}

const secretsFileSchema = z.strictObject({
  schemaVersion: z.literal(1),
  secrets: z.record(z.string(), z.string()),
});

type SecretsFile = z.infer<typeof secretsFileSchema>;

function validateSecretId(secretId: string): string {
  const normalized = secretId.trim();
  if (
    normalized.length === 0 ||
    normalized.length > 256 ||
    [...normalized].some((character) => {
      const code = character.charCodeAt(0);
      return code <= 31 || code === 127;
    })
  ) {
    throw new Error(
      "Secret ID must be 1-256 characters without control characters",
    );
  }
  return normalized;
}

export class KeyringSecretStore implements SecretStore {
  readonly status: SecretBackendStatus = {
    backend: "keyring",
    secure: true,
  };

  constructor(private readonly Entry: KeyringModuleLike["Entry"]) {}

  async get(secretId: string): Promise<string | undefined> {
    const id = validateSecretId(secretId);
    const current = new this.Entry(SECRET_SERVICE, id).getPassword();
    if (current !== null) return current;

    const legacy = new this.Entry(LEGACY_SECRET_SERVICE, id);
    const value = legacy.getPassword();
    if (value === null) return undefined;
    new this.Entry(SECRET_SERVICE, id).setPassword(value);
    try {
      legacy.deleteCredential();
    } catch {
      // The credential is already available under the current service name.
    }
    return value;
  }

  async set(secretId: string, value: string): Promise<void> {
    if (value.length === 0) {
      throw new Error("Secret value cannot be empty");
    }
    new this.Entry(SECRET_SERVICE, validateSecretId(secretId)).setPassword(
      value,
    );
  }

  async delete(secretId: string): Promise<boolean> {
    const id = validateSecretId(secretId);
    let currentDeleted = false;
    let legacyDeleted = false;
    let currentError: unknown;
    let legacyError: unknown;
    try {
      currentDeleted = new this.Entry(SECRET_SERVICE, id).deleteCredential();
    } catch (error) {
      currentError = error;
    }
    try {
      legacyDeleted = new this.Entry(
        LEGACY_SECRET_SERVICE,
        id,
      ).deleteCredential();
    } catch (error) {
      legacyError = error;
    }
    if (currentDeleted || legacyDeleted) return true;
    if (currentError) throw currentError;
    if (legacyError) throw legacyError;
    return false;
  }
}

export class FileSecretStore implements SecretStore {
  readonly status: SecretBackendStatus;
  private readonly file: string;
  private readonly lockFile: string;

  constructor(paths: RuntimePaths = resolveRuntimePaths(), reason?: string) {
    this.file = getSecretsFile(paths);
    this.lockFile = getSecretLockFile(paths);
    this.status = {
      backend: "file",
      secure: false,
      path: this.file,
      warning:
        "System keyring unavailable; secrets are stored as plaintext in a permission-0600 JSON file." +
        (reason ? ` (${reason})` : ""),
    };
  }

  async get(secretId: string): Promise<string | undefined> {
    const id = validateSecretId(secretId);
    return (await this.load()).secrets[id];
  }

  async set(secretId: string, value: string): Promise<void> {
    const id = validateSecretId(secretId);
    if (value.length === 0) {
      throw new Error("Secret value cannot be empty");
    }

    await withFileLock(this.lockFile, async () => {
      const data = await this.load();
      data.secrets[id] = value;
      await atomicWriteJson(this.file, data, { mode: 0o600 });
    });
  }

  async delete(secretId: string): Promise<boolean> {
    const id = validateSecretId(secretId);
    return withFileLock(this.lockFile, async () => {
      const data = await this.load();
      if (!(id in data.secrets)) {
        return false;
      }
      delete data.secrets[id];
      await atomicWriteJson(this.file, data, { mode: 0o600 });
      return true;
    });
  }

  private async load(): Promise<SecretsFile> {
    let raw: string;
    try {
      raw = await readFile(this.file, "utf8");
      if (process.platform !== "win32") {
        await chmod(this.file, 0o600);
      }
    } catch (error) {
      if (isNotFoundError(error)) {
        return { schemaVersion: 1, secrets: {} };
      }
      throw error;
    }

    let value: unknown;
    try {
      value = JSON.parse(raw) as unknown;
    } catch (error) {
      throw new Error(`Secret fallback file is not valid JSON: ${this.file}`, {
        cause: error,
      });
    }

    const parsed = secretsFileSchema.safeParse(value);
    if (!parsed.success) {
      throw new Error(`Secret fallback file is invalid: ${this.file}`, {
        cause: parsed.error,
      });
    }
    return parsed.data;
  }
}

async function loadKeyringModule(): Promise<KeyringModuleLike> {
  // Keep the native optional dependency out of the JS bundle. Each platform
  // resolves its own binary at runtime, and a missing package triggers fallback.
  const moduleName: string = "@napi-rs/keyring";
  return import(moduleName);
}

function compactError(error: unknown): string {
  if (!(error instanceof Error)) {
    return "unknown keyring error";
  }
  return error.message.split(/\r?\n/, 1)[0] || error.name;
}

function probeKeyring(keyring: KeyringModuleLike): void {
  const id = `probe-${process.pid}-${randomUUID()}`;
  const expected = randomBytes(24).toString("base64url");
  const entry = new keyring.Entry(SECRET_SERVICE, id);

  try {
    entry.setPassword(expected);
    if (entry.getPassword() !== expected) {
      throw new Error("keyring probe returned an unexpected value");
    }
  } finally {
    try {
      entry.deleteCredential();
    } catch {
      // The original probe error carries the useful backend failure.
    }
  }
}

export async function createSecretStore(
  options: CreateSecretStoreOptions = {},
): Promise<SecretStore> {
  const paths = options.paths ?? resolveRuntimePaths();
  let keyring: KeyringModuleLike | null;

  try {
    keyring =
      "keyringModule" in options
        ? (options.keyringModule ?? null)
        : await loadKeyringModule();
    if (keyring === null) {
      return new FileSecretStore(paths, "keyring disabled or not installed");
    }
    probeKeyring(keyring);
    return new KeyringSecretStore(keyring.Entry);
  } catch (error) {
    return new FileSecretStore(paths, compactError(error));
  }
}
