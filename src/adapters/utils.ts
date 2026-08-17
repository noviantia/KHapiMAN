import {
  access,
  constants as fsConstants,
  readFile,
  stat,
} from "node:fs/promises";
import path from "node:path";
import crossSpawn from "cross-spawn";
import type {
  RelayProfile,
  RuntimePaths,
  ToolId,
  ToolStatus,
} from "../types.js";
import { TOOL_LABELS } from "../constants.js";

export async function readOptionalFile(
  filePath: string,
  fallback: string,
): Promise<string> {
  try {
    return await readFile(filePath, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return fallback;
    }
    throw error;
  }
}

export async function fileExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

export async function findExecutable(
  command: string,
): Promise<string | undefined> {
  const pathValue = process.env.PATH ?? "";
  const pathEntries = pathValue.split(path.delimiter);
  const commandNames =
    process.platform === "win32" && !path.extname(command)
      ? [
          ...(process.env.PATHEXT ?? ".COM;.EXE;.BAT;.CMD")
            .split(";")
            .filter(Boolean)
            .map((extension) => `${command}${extension.toLowerCase()}`),
          command,
        ]
      : [command];

  for (const entry of pathEntries) {
    const directory = entry || ".";
    for (const name of commandNames) {
      const candidate = path.isAbsolute(name)
        ? name
        : path.join(directory, name);
      try {
        const candidateStat = await stat(candidate);
        if (!candidateStat.isFile()) continue;
        await access(
          candidate,
          process.platform === "win32" ? fsConstants.F_OK : fsConstants.X_OK,
        );
        return path.normalize(candidate);
      } catch {
        // Continue searching the remaining PATH entries.
      }
    }
  }
  return undefined;
}

export async function executableVersion(
  executable: string,
): Promise<string | undefined> {
  return new Promise((resolve) => {
    let output = "";
    let settled = false;
    let timer: NodeJS.Timeout | undefined;
    const finish = (value: string | undefined) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      resolve(value);
    };
    const append = (chunk: Buffer | string) => {
      if (output.length >= 8_192) return;
      output += Buffer.isBuffer(chunk) ? chunk.toString("utf8") : chunk;
      if (output.length > 8_192) output = output.slice(0, 8_192);
    };

    try {
      const child = crossSpawn(executable, ["--version"], {
        stdio: ["ignore", "pipe", "pipe"],
        windowsHide: true,
      });
      child.stdout?.on("data", append);
      child.stderr?.on("data", append);
      child.once("error", () => finish(undefined));
      child.once("close", () => {
        finish(output.trim().split(/\r?\n/u)[0] || undefined);
      });
      timer = setTimeout(() => {
        child.kill();
        finish(undefined);
      }, 4_000);
    } catch {
      finish(undefined);
    }
  });
}

export async function basicDetect(options: {
  id: ToolId;
  command: string;
  configPath: string;
  isConfigured(source: string): boolean;
  paths: RuntimePaths;
}): Promise<ToolStatus> {
  const [executable, source] = await Promise.all([
    findExecutable(options.command),
    readOptionalFile(options.configPath, ""),
  ]);
  const version = executable ? await executableVersion(executable) : undefined;
  return {
    id: options.id,
    label: TOOL_LABELS[options.id],
    installed: Boolean(executable),
    ...(executable ? { executable } : {}),
    ...(version ? { version } : {}),
    configPath: path.normalize(options.configPath),
    configured: options.isConfigured(source),
  };
}

export function assertProtocol(
  profile: RelayProfile,
  accepted: readonly RelayProfile["protocols"][number][],
  toolLabel: string,
): void {
  if (!profile.protocols.some((protocol) => accepted.includes(protocol))) {
    throw new Error(
      `${toolLabel} is not compatible with the protocols in ${profile.name}.`,
    );
  }
}

export function requireModel(
  model: string | undefined,
  toolLabel: string,
): string {
  const value = model?.trim();
  if (!value) {
    throw new Error(`${toolLabel} requires an explicit relay model name.`);
  }
  return value;
}

export function secretEnvironmentName(profileId: string): string {
  return `KHAPIMAN_API_KEY_${profileId.replace(/[^a-zA-Z0-9]/gu, "_").toUpperCase()}`;
}
