import { homedir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";

import type { RuntimePaths } from "./types.js";

export interface ResolveRuntimePathsOptions {
  env?: NodeJS.ProcessEnv;
  homeDir?: string;
}

function expandHome(value: string, home: string): string {
  if (value === "~") {
    return home;
  }

  if (value.startsWith("~/") || value.startsWith("~\\")) {
    return join(home, value.slice(2));
  }

  return value;
}

export function resolveRuntimePaths(
  options: ResolveRuntimePathsOptions = {},
): RuntimePaths {
  const env = options.env ?? process.env;
  const home = resolve(options.homeDir ?? homedir());
  const configuredHome = env.KHAPIMAN_HOME?.trim();
  const dataDir = configuredHome
    ? resolve(expandHome(configuredHome, home))
    : join(home, ".khapiman");

  return {
    home,
    dataDir,
    stateFile: join(dataDir, "state.json"),
    backupDir: join(dataDir, "backups"),
    lockFile: join(dataDir, "khapiman.lock"),
  };
}

export function getSecretsFile(paths: RuntimePaths): string {
  return join(paths.dataDir, "secrets.json");
}

export function getSecretLockFile(paths: RuntimePaths): string {
  return join(paths.dataDir, "secrets.lock");
}

export function resolveFromHome(path: string, home = homedir()): string {
  const expanded = expandHome(path.trim(), resolve(home));
  return isAbsolute(expanded) ? resolve(expanded) : resolve(home, expanded);
}
