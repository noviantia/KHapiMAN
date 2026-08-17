import { EventEmitter } from "node:events";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { InstallResult } from "../src/installers.js";
import type { ToolId } from "../src/types.js";
import type { UiSnapshot } from "../src/ui/types.js";

const mocks = vi.hoisted(() => ({
  detectTools: vi.fn(),
  snapshot: vi.fn(),
  installTools: vi.fn(),
  runEnvironment: vi.fn(),
  spawn: vi.fn(),
}));

vi.mock("../src/controller.js", () => ({
  Controller: class {
    detectTools() {
      return mocks.detectTools();
    }

    snapshot() {
      return mocks.snapshot();
    }

    installTools(tools: ToolId[]) {
      return mocks.installTools(tools);
    }

    runEnvironment(tool: ToolId) {
      return mocks.runEnvironment(tool);
    }
  },
}));

vi.mock("cross-spawn", () => ({ default: mocks.spawn }));

afterEach(() => {
  vi.restoreAllMocks();
  mocks.detectTools.mockReset();
  mocks.snapshot.mockReset();
  mocks.installTools.mockReset();
  mocks.runEnvironment.mockReset();
  mocks.spawn.mockReset();
  vi.resetModules();
});

describe("install CLI", () => {
  it("dry-runs only requested tools that are still missing", async () => {
    const snapshot: UiSnapshot = {
      state: { schemaVersion: 1, profiles: [], bindings: {} },
      statuses: [
        {
          id: "codex",
          label: "Codex CLI",
          installed: true,
          configured: false,
          configPath: "/home/test/.codex/config.toml",
        },
        {
          id: "claude",
          label: "Claude Code",
          installed: false,
          configured: false,
          configPath: "/home/test/.claude/settings.json",
        },
      ],
      transactions: [],
      secretBackend: "test backend",
      secretBackendSecure: true,
    };
    const installTools = vi.fn(
      async (tools: ToolId[]): Promise<InstallResult[]> => {
        void tools;
        return [];
      },
    );
    mocks.detectTools.mockResolvedValue(snapshot.statuses);
    mocks.snapshot.mockResolvedValue(snapshot);
    mocks.installTools.mockImplementation(installTools);

    const stdout: string[] = [];
    const stderr: string[] = [];
    vi.spyOn(process.stdout, "write").mockImplementation((chunk) => {
      stdout.push(String(chunk));
      return true;
    });
    vi.spyOn(process.stderr, "write").mockImplementation((chunk) => {
      stderr.push(String(chunk));
      return true;
    });
    const originalArgv = process.argv;
    process.argv = [
      process.execPath,
      "khapiman",
      "--ascii",
      "install",
      "--tool",
      "codex",
      "claude",
      "--dry-run",
    ];

    try {
      await import("../src/cli.js");
      await vi.waitFor(() => {
        expect(stdout.join("")).toContain("Codex CLI is already installed.");
        expect(stdout.join("")).toContain("Installation plan:");
        expect(stdout.join("")).toContain(
          "Claude Code: npm install --global @anthropic-ai/claude-code",
        );
      });
      expect(stdout.join("")).not.toContain(
        "Codex CLI: npm install --global @openai/codex",
      );
      expect(installTools).not.toHaveBeenCalled();
      expect(stderr).toEqual([]);
    } finally {
      process.argv = originalArgv;
    }
  });

  it("strips the run delimiter and prepends adapter launch arguments", async () => {
    mocks.spawn.mockImplementation(() => {
      const child = new EventEmitter();
      queueMicrotask(() => child.emit("exit", 0, null));
      return child;
    });
    const runEnvironment = vi.fn(async () => ({
      command: "aider-command",
      args: ["--adapter-prefix"],
      env: { PATH: "test-path", KHAPIMAN_API_KEY: "secret" },
    }));
    mocks.runEnvironment.mockImplementation(runEnvironment);

    const originalArgv = process.argv;
    const originalExitCode = process.exitCode;
    process.argv = [
      process.execPath,
      "khapiman",
      "--ascii",
      "run",
      "--trust-workspace",
      "aider",
      "--",
      "--child-option",
      "value",
    ];

    try {
      await import("../src/cli.js");
      await vi.waitFor(() => expect(mocks.spawn).toHaveBeenCalledOnce());
      expect(runEnvironment).toHaveBeenCalledWith("aider");
      expect(mocks.spawn).toHaveBeenCalledWith(
        "aider-command",
        ["--adapter-prefix", "--child-option", "value"],
        expect.objectContaining({
          stdio: "inherit",
          env: expect.objectContaining({ KHAPIMAN_API_KEY: "secret" }),
        }),
      );
    } finally {
      process.argv = originalArgv;
      process.exitCode = originalExitCode;
    }
  });
});
