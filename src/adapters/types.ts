import process from "node:process";

import type {
  FileChange,
  RelayProfile,
  RelayProtocol,
  RuntimePaths,
  ToolId,
  ToolStatus,
} from "../types.js";

export interface AdapterPlanOptions {
  model?: string;
}

export interface ToolAdapter {
  readonly id: ToolId;
  readonly label: string;
  readonly command: string;
  readonly protocols: readonly RelayProtocol[];
  configPath(paths: RuntimePaths): Promise<string> | string;
  detect(paths: RuntimePaths): Promise<ToolStatus>;
  plan(
    paths: RuntimePaths,
    profile: RelayProfile,
    options: AdapterPlanOptions,
  ): Promise<FileChange[]>;
  environment(
    profile: RelayProfile,
    secret: string,
    model?: string,
  ): NodeJS.ProcessEnv;
  unsetEnvironment?: readonly string[];
  launchArgs?(profile: RelayProfile, model?: string): string[];
}

export function mergeAdapterEnvironment(
  inherited: NodeJS.ProcessEnv,
  overrides: NodeJS.ProcessEnv,
  unset: readonly string[] = [],
  platform: NodeJS.Platform = process.platform,
): NodeJS.ProcessEnv {
  const environment = { ...inherited };
  const key =
    platform === "win32" ? (value: string) => value.toUpperCase() : undefined;

  for (const [name, value] of Object.entries(overrides)) {
    if (key) {
      for (const existing of Object.keys(environment)) {
        if (key(existing) === key(name)) delete environment[existing];
      }
    }
    if (value === undefined) delete environment[name];
    else environment[name] = value;
  }

  const blocked = new Set(unset.map((name) => (key ? key(name) : name)));
  for (const name of Object.keys(environment)) {
    if (blocked.has(key ? key(name) : name)) delete environment[name];
  }
  return environment;
}
