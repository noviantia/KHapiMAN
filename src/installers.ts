import crossSpawn from "cross-spawn";

import { TOOL_IDS } from "./types.js";
import type { ToolId } from "./types.js";

export const INSTALLER_PLATFORMS = ["win32", "darwin", "linux"] as const;

export type InstallerPlatform = (typeof INSTALLER_PLATFORMS)[number];

export interface InstallPlan {
  readonly tool: ToolId;
  readonly platform: InstallerPlatform;
  readonly executable: string;
  readonly args: readonly string[];
  readonly displayCommand: string;
}

export interface InstallerRunnerInvocation {
  readonly executable: string;
  readonly args: readonly string[];
  readonly maxOutputBytes: number;
  readonly timeoutMs?: number;
}

export interface InstallerRunnerOutcome {
  readonly exitCode: number | null;
  readonly output: string;
}

export type InstallerRunner = (
  invocation: InstallerRunnerInvocation,
) => Promise<InstallerRunnerOutcome>;

export interface InstallToolsOptions {
  platform?: InstallerPlatform;
  runner?: InstallerRunner;
  maxOutputBytes?: number;
  timeoutMs?: number;
}

export interface InstallResult {
  readonly tool: ToolId;
  readonly command: string;
  readonly success: boolean;
  readonly exitCode: number | null;
  readonly outputSummary: string;
}

const DEFAULT_MAX_OUTPUT_BYTES = 32 * 1024;
const MIN_MAX_OUTPUT_BYTES = 256;
const MAX_MAX_OUTPUT_BYTES = 1024 * 1024;
const DEFAULT_TIMEOUT_MS = 15 * 60 * 1_000;
const MIN_TIMEOUT_MS = 1_000;
const MAX_TIMEOUT_MS = 60 * 60 * 1_000;

interface FixedCommand {
  readonly executable: string;
  readonly args: readonly string[];
  readonly displayCommand: string;
}

function fixedCommand(
  executable: string,
  args: readonly string[],
  displayCommand: string,
): FixedCommand {
  return Object.freeze({
    executable,
    args: Object.freeze([...args]),
    displayCommand,
  });
}

const NPM_INSTALLERS = Object.freeze({
  codex: fixedCommand(
    "npm",
    ["install", "--global", "@openai/codex"],
    "npm install --global @openai/codex",
  ),
  claude: fixedCommand(
    "npm",
    ["install", "--global", "@anthropic-ai/claude-code"],
    "npm install --global @anthropic-ai/claude-code",
  ),
  opencode: fixedCommand(
    "npm",
    ["install", "--global", "opencode-ai"],
    "npm install --global opencode-ai",
  ),
});

const AIDER_WINDOWS = fixedCommand(
  "powershell",
  [
    "-ExecutionPolicy",
    "ByPass",
    "-c",
    "irm https://aider.chat/install.ps1 | iex",
  ],
  'powershell -ExecutionPolicy ByPass -c "irm https://aider.chat/install.ps1 | iex"',
);

const AIDER_POSIX = fixedCommand(
  "sh",
  ["-c", "curl -LsSf https://aider.chat/install.sh | sh"],
  "curl -LsSf https://aider.chat/install.sh | sh",
);

function assertToolId(value: unknown): asserts value is ToolId {
  if (
    typeof value !== "string" ||
    !(TOOL_IDS as readonly string[]).includes(value)
  ) {
    throw new TypeError(`Unsupported tool installer: ${String(value)}`);
  }
}

function assertPlatform(value: unknown): asserts value is InstallerPlatform {
  if (
    typeof value !== "string" ||
    !(INSTALLER_PLATFORMS as readonly string[]).includes(value)
  ) {
    throw new TypeError(`Unsupported installer platform: ${String(value)}`);
  }
}

function commandFor(tool: ToolId, platform: InstallerPlatform): FixedCommand {
  if (tool === "aider") {
    return platform === "win32" ? AIDER_WINDOWS : AIDER_POSIX;
  }
  return NPM_INSTALLERS[tool];
}

function currentInstallerPlatform(): InstallerPlatform {
  assertPlatform(process.platform);
  return process.platform;
}

export function getInstallPlan(
  tool: ToolId,
  platform: InstallerPlatform = currentInstallerPlatform(),
): InstallPlan {
  assertToolId(tool);
  assertPlatform(platform);
  const command = commandFor(tool, platform);
  return Object.freeze({
    tool,
    platform,
    executable: command.executable,
    args: command.args,
    displayCommand: command.displayCommand,
  });
}

export function createInstallPlan(
  tools: readonly ToolId[],
  platform: InstallerPlatform = currentInstallerPlatform(),
): InstallPlan[] {
  assertPlatform(platform);
  for (const tool of tools) {
    assertToolId(tool);
  }
  return [...new Set(tools)].map((tool) => getInstallPlan(tool, platform));
}

export function getInstallCommand(
  tool: ToolId,
  platform: InstallerPlatform = currentInstallerPlatform(),
): string {
  return getInstallPlan(tool, platform).displayCommand;
}

export function previewInstallCommands(
  tools: readonly ToolId[],
  platform: InstallerPlatform = currentInstallerPlatform(),
): string[] {
  return createInstallPlan(tools, platform).map((plan) => plan.displayCommand);
}

class BoundedCapture {
  private tail = Buffer.alloc(0);
  private truncated = false;

  constructor(private readonly limit: number) {}

  append(value: Buffer | string): void {
    const chunk = Buffer.isBuffer(value) ? value : Buffer.from(value);
    const combined = Buffer.concat([this.tail, chunk]);
    if (combined.byteLength > this.limit) {
      this.truncated = true;
      this.tail = combined.subarray(combined.byteLength - this.limit);
      return;
    }
    this.tail = combined;
  }

  toString(): string {
    const text = this.tail
      .toString("utf8")
      .replace(/^\uFFFD+/u, "")
      .trim();
    return this.truncated ? `[output truncated]\n${text}` : text;
  }
}

function normalizeOutputLimit(value: number | undefined): number {
  if (value === undefined) {
    return DEFAULT_MAX_OUTPUT_BYTES;
  }
  if (
    !Number.isSafeInteger(value) ||
    value < MIN_MAX_OUTPUT_BYTES ||
    value > MAX_MAX_OUTPUT_BYTES
  ) {
    throw new RangeError(
      `maxOutputBytes must be an integer between ${MIN_MAX_OUTPUT_BYTES} and ${MAX_MAX_OUTPUT_BYTES}`,
    );
  }
  return value;
}

function normalizeTimeout(value: number | undefined): number {
  const timeout = value ?? DEFAULT_TIMEOUT_MS;
  if (
    !Number.isSafeInteger(timeout) ||
    timeout < MIN_TIMEOUT_MS ||
    timeout > MAX_TIMEOUT_MS
  ) {
    throw new RangeError(
      `timeoutMs must be an integer between ${MIN_TIMEOUT_MS} and ${MAX_TIMEOUT_MS}`,
    );
  }
  return timeout;
}

export function summarizeInstallerOutput(
  output: string,
  maxOutputBytes = DEFAULT_MAX_OUTPUT_BYTES,
): string {
  const limit = normalizeOutputLimit(maxOutputBytes);
  const capture = new BoundedCapture(limit);
  capture.append(output);
  return capture.toString();
}

export const defaultInstallerRunner: InstallerRunner = async ({
  executable,
  args,
  maxOutputBytes,
  timeoutMs,
}) => {
  const limit = normalizeOutputLimit(maxOutputBytes);
  const timeout = normalizeTimeout(timeoutMs);
  const capture = new BoundedCapture(limit);

  return new Promise<InstallerRunnerOutcome>((resolve) => {
    let settled = false;
    let timer: NodeJS.Timeout | undefined;
    const finish = (outcome: InstallerRunnerOutcome) => {
      if (settled) {
        return;
      }
      settled = true;
      if (timer) clearTimeout(timer);
      resolve(outcome);
    };

    try {
      const child = crossSpawn(executable, [...args], {
        shell: false,
        stdio: ["ignore", "pipe", "pipe"],
        windowsHide: true,
      });
      child.stdout?.on("data", (chunk: Buffer | string) =>
        capture.append(chunk),
      );
      child.stderr?.on("data", (chunk: Buffer | string) =>
        capture.append(chunk),
      );
      child.once("error", (error) => {
        capture.append(error.message);
        finish({ exitCode: null, output: capture.toString() });
      });
      child.once("close", (exitCode, signal) => {
        if (signal) {
          capture.append(`Process terminated by ${signal}`);
        }
        finish({ exitCode, output: capture.toString() });
      });
      timer = setTimeout(() => {
        capture.append(`Process timed out after ${timeout} ms`);
        child.kill();
        finish({ exitCode: null, output: capture.toString() });
      }, timeout);
    } catch (error) {
      capture.append(error instanceof Error ? error.message : String(error));
      finish({ exitCode: null, output: capture.toString() });
    }
  });
};

export async function installTools(
  tools: readonly ToolId[],
  options: InstallToolsOptions = {},
): Promise<InstallResult[]> {
  const platform = options.platform ?? currentInstallerPlatform();
  const plans = createInstallPlan(tools, platform);
  const runner = options.runner ?? defaultInstallerRunner;
  const maxOutputBytes = normalizeOutputLimit(options.maxOutputBytes);
  const timeoutMs = normalizeTimeout(options.timeoutMs);
  const results: InstallResult[] = [];

  for (const plan of plans) {
    try {
      const outcome = await runner({
        executable: plan.executable,
        args: plan.args,
        maxOutputBytes,
        timeoutMs,
      });
      const exitCode = Number.isInteger(outcome.exitCode)
        ? outcome.exitCode
        : null;
      results.push({
        tool: plan.tool,
        command: plan.displayCommand,
        success: exitCode === 0,
        exitCode,
        outputSummary: summarizeInstallerOutput(outcome.output, maxOutputBytes),
      });
    } catch (error) {
      results.push({
        tool: plan.tool,
        command: plan.displayCommand,
        success: false,
        exitCode: null,
        outputSummary: summarizeInstallerOutput(
          error instanceof Error ? error.message : String(error),
          maxOutputBytes,
        ),
      });
    }
  }

  return results;
}
