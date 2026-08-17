import { readFile } from "node:fs/promises";

import type { AppState, RuntimePaths } from "../types.js";
import {
  atomicWriteJson,
  ensurePrivateDirectory,
  isNotFoundError,
} from "../core/fs.js";
import { resolveRuntimePaths } from "../paths.js";
import { appStateSchema } from "./schema.js";

export class StateValidationError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "StateValidationError";
  }
}

export function emptyState(): AppState {
  return { schemaVersion: 1, profiles: [], bindings: {} };
}

export function validateState(value: unknown): AppState {
  const parsed = appStateSchema.safeParse(value);
  if (!parsed.success) {
    throw new StateValidationError(
      `Invalid KHapiMAN state: ${parsed.error.issues
        .map((issue) => `${issue.path.join(".") || "<root>"}: ${issue.message}`)
        .join("; ")}`,
      { cause: parsed.error },
    );
  }
  return parsed.data as AppState;
}

export async function loadState(
  paths: RuntimePaths = resolveRuntimePaths(),
): Promise<AppState> {
  let raw: string;
  try {
    raw = await readFile(paths.stateFile, "utf8");
  } catch (error) {
    if (isNotFoundError(error)) {
      return emptyState();
    }
    throw error;
  }

  let value: unknown;
  try {
    value = JSON.parse(raw) as unknown;
  } catch (error) {
    throw new StateValidationError(
      `KHapiMAN state is not valid JSON: ${paths.stateFile}`,
      { cause: error },
    );
  }

  return validateState(value);
}

export async function saveState(
  state: AppState,
  paths: RuntimePaths = resolveRuntimePaths(),
): Promise<AppState> {
  const validated = validateState(state);
  await ensurePrivateDirectory(paths.dataDir);
  await atomicWriteJson(paths.stateFile, validated, { mode: 0o600 });
  return validated;
}
