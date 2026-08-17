import { describe, expect, it } from "vitest";

import {
  createInstallPlan,
  defaultInstallerRunner,
  getInstallCommand,
  getInstallPlan,
  installTools,
  previewInstallCommands,
  type InstallerRunner,
} from "../src/installers.js";
import type { ToolId } from "../src/types.js";

describe("installer plans", () => {
  it("maps npm installers identically on all supported platforms", () => {
    for (const platform of ["win32", "darwin", "linux"] as const) {
      expect(getInstallPlan("codex", platform)).toMatchObject({
        executable: "npm",
        args: ["install", "--global", "@openai/codex"],
        displayCommand: "npm install --global @openai/codex",
      });
      expect(getInstallCommand("claude", platform)).toBe(
        "npm install --global @anthropic-ai/claude-code",
      );
      expect(getInstallCommand("opencode", platform)).toBe(
        "npm install --global opencode-ai",
      );
    }
  });

  it("uses the official platform-specific Aider scripts", () => {
    expect(getInstallPlan("aider", "win32")).toMatchObject({
      executable: "powershell",
      args: [
        "-ExecutionPolicy",
        "ByPass",
        "-c",
        "irm https://aider.chat/install.ps1 | iex",
      ],
      displayCommand:
        'powershell -ExecutionPolicy ByPass -c "irm https://aider.chat/install.ps1 | iex"',
    });
    for (const platform of ["darwin", "linux"] as const) {
      expect(getInstallPlan("aider", platform)).toMatchObject({
        executable: "sh",
        args: ["-c", "curl -LsSf https://aider.chat/install.sh | sh"],
        displayCommand: "curl -LsSf https://aider.chat/install.sh | sh",
      });
    }
  });

  it("deduplicates tools while preserving first-seen order", () => {
    const plans = createInstallPlan(
      ["claude", "codex", "claude", "aider", "codex"],
      "linux",
    );
    expect(plans.map((plan) => plan.tool)).toEqual([
      "claude",
      "codex",
      "aider",
    ]);
    expect(
      previewInstallCommands(["codex", "codex", "opencode"], "darwin"),
    ).toEqual([
      "npm install --global @openai/codex",
      "npm install --global opencode-ai",
    ]);
  });
});

describe("installer execution", () => {
  it("runs sequentially and continues after non-zero exits and runner errors", async () => {
    const events: string[] = [];
    const runner: InstallerRunner = async ({ args }) => {
      const packageName = args.at(-1) ?? "";
      events.push(`start:${packageName}`);
      await Promise.resolve();
      events.push(`end:${packageName}`);
      if (packageName === "@anthropic-ai/claude-code") {
        return { exitCode: 7, output: "permission denied" };
      }
      if (packageName === "opencode-ai") {
        throw new Error("runner unavailable");
      }
      return { exitCode: 0, output: "installed" };
    };

    const results = await installTools(
      ["codex", "claude", "opencode", "aider"],
      { platform: "linux", runner },
    );
    expect(events).toEqual([
      "start:@openai/codex",
      "end:@openai/codex",
      "start:@anthropic-ai/claude-code",
      "end:@anthropic-ai/claude-code",
      "start:opencode-ai",
      "end:opencode-ai",
      "start:curl -LsSf https://aider.chat/install.sh | sh",
      "end:curl -LsSf https://aider.chat/install.sh | sh",
    ]);
    expect(
      results.map(({ tool, success, exitCode }) => ({
        tool,
        success,
        exitCode,
      })),
    ).toEqual([
      { tool: "codex", success: true, exitCode: 0 },
      { tool: "claude", success: false, exitCode: 7 },
      { tool: "opencode", success: false, exitCode: null },
      { tool: "aider", success: true, exitCode: 0 },
    ]);
    expect(results[2]?.outputSummary).toBe("runner unavailable");
  });

  it("validates every ToolId before invoking a runner", async () => {
    let calls = 0;
    const runner: InstallerRunner = async () => {
      calls += 1;
      return { exitCode: 0, output: "unexpected" };
    };
    const injected = "codex; echo injected" as ToolId;

    await expect(
      installTools(["codex", injected], { platform: "linux", runner }),
    ).rejects.toThrow("Unsupported tool installer");
    expect(calls).toBe(0);
  });

  it("uses cross-spawn by default and bounds captured output", async () => {
    const outcome = await defaultInstallerRunner({
      executable: process.execPath,
      args: ["-e", 'process.stdout.write("x".repeat(4096))'],
      maxOutputBytes: 256,
    });
    expect(outcome.exitCode).toBe(0);
    expect(outcome.output).toContain("[output truncated]");
    expect(Buffer.byteLength(outcome.output)).toBeLessThan(320);
  });

  it("times out a stalled installer process", async () => {
    const outcome = await defaultInstallerRunner({
      executable: process.execPath,
      args: ["-e", "setTimeout(() => {}, 5000)"],
      maxOutputBytes: 256,
      timeoutMs: 1_000,
    });
    expect(outcome.exitCode).toBeNull();
    expect(outcome.output).toContain("Process timed out after 1000 ms");
  });
});
