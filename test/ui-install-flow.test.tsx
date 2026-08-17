import React from "react";
import { cleanup, render } from "ink-testing-library";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { InstallResult } from "../src/installers.js";
import type { ToolId, ToolStatus } from "../src/types.js";
import { App } from "../src/ui/App.js";
import type { KhapimanController, UiSnapshot } from "../src/ui/types.js";

afterEach(() => {
  cleanup();
});

function status(id: ToolId, label: string, installed: boolean): ToolStatus {
  return {
    id,
    label,
    installed,
    configured: false,
    configPath: `/home/test/.config/${id}`,
  };
}

async function settleInput(): Promise<void> {
  // Ink attaches useInput listeners in an effect; allow that effect to run
  // after each screen assertion before sending the next synthetic keystroke.
  await new Promise<void>((resolve) => setTimeout(resolve, 25));
}

describe("interactive installer flow", () => {
  it("uses the highlighted tool when Enter is pressed without a Space selection", async () => {
    const snapshot: UiSnapshot = {
      state: { schemaVersion: 1, profiles: [], bindings: {} },
      statuses: [
        status("codex", "Codex CLI", true),
        status("claude", "Claude Code", false),
        status("opencode", "OpenCode", true),
        status("aider", "Aider", false),
      ],
      transactions: [],
      secretBackend: "OS credential vault",
      secretBackendSecure: true,
    };
    const unexpected = async (): Promise<never> => {
      throw new Error("Unexpected controller call");
    };
    const controller: KhapimanController = {
      snapshot: vi.fn(async () => snapshot),
      detectTools: vi.fn(async () => snapshot.statuses),
      installTools: vi.fn(async () => []),
      fetchModels: unexpected,
      createProfile: unexpected,
      deleteProfile: unexpected,
      previewApply: unexpected,
      apply: unexpected,
      doctor: vi.fn(async () => []),
      testConnection: vi.fn(async () => []),
      rollback: unexpected,
    };

    const view = render(
      <App controller={controller} ascii initialLocale="en" />,
    );
    await vi.waitFor(() => {
      expect(view.lastFrame()).toContain(
        "Choose interface language / 请选择界面语言",
      );
    });

    await settleInput();
    view.stdin.write("\r");
    await vi.waitFor(() => {
      expect(view.lastFrame()).toContain("API Profiles");
    });

    await settleInput();
    view.stdin.write("\u001B[B\u001B[B\r");
    await vi.waitFor(() => {
      expect(view.lastFrame()).toContain("Client actions");
    });

    await settleInput();
    view.stdin.write("\u001B[B\r");
    await vi.waitFor(() => {
      expect(view.lastFrame()).toContain("Missing coding CLIs");
    });

    await settleInput();
    view.stdin.write("\u001B[B\r");
    await vi.waitFor(() => {
      const frame = view.lastFrame();
      expect(frame).toContain("Review installation commands");
      expect(frame).toContain("aider.chat/install");
      expect(frame).not.toContain("@anthropic-ai/claude-code");
    });
  });

  it("offers only missing tools and installs only the confirmed selection", async () => {
    const snapshot: UiSnapshot = {
      state: { schemaVersion: 1, profiles: [], bindings: {} },
      statuses: [
        status("codex", "Codex CLI", true),
        status("claude", "Claude Code", false),
        status("opencode", "OpenCode", true),
        status("aider", "Aider", false),
      ],
      transactions: [],
      secretBackend: "OS credential vault",
      secretBackendSecure: true,
    };
    const installTools = vi.fn(
      async (tools: ToolId[]): Promise<InstallResult[]> =>
        tools.map((tool) => ({
          tool,
          command: "npm install --global @anthropic-ai/claude-code",
          success: true,
          exitCode: 0,
          outputSummary: "installed",
        })),
    );
    const unexpected = async (): Promise<never> => {
      throw new Error("Unexpected controller call");
    };
    const controller: KhapimanController = {
      snapshot: vi.fn(async () => snapshot),
      detectTools: vi.fn(async () => snapshot.statuses),
      installTools,
      fetchModels: unexpected,
      createProfile: unexpected,
      deleteProfile: unexpected,
      previewApply: unexpected,
      apply: unexpected,
      doctor: vi.fn(async () => []),
      testConnection: vi.fn(async () => []),
      rollback: unexpected,
    };

    const view = render(
      <App controller={controller} ascii initialLocale="en" />,
    );
    await vi.waitFor(() => {
      expect(view.lastFrame()).toContain(
        "Choose interface language / 请选择界面语言",
      );
      expect(view.lastFrame()).toContain("English");
    });

    await settleInput();
    view.stdin.write("\r");
    await vi.waitFor(() => {
      expect(view.lastFrame()).toContain("API Profiles");
    });

    await settleInput();
    view.stdin.write("\u001B[B\u001B[B\r");
    await vi.waitFor(() => {
      expect(view.lastFrame()).toContain("Client actions");
    });

    await settleInput();
    view.stdin.write("\u001B[B\r");
    await vi.waitFor(() => {
      const frame = view.lastFrame();
      expect(frame).toContain("Missing coding CLIs");
      expect(frame).toContain("Claude Code");
      expect(frame).toContain("Aider");
      expect(frame).not.toContain("Codex CLI");
      expect(frame).not.toContain("OpenCode");
    });

    await settleInput();
    view.stdin.write("\u001B");
    await vi.waitFor(() => {
      expect(view.lastFrame()).toContain("Client actions");
    });
    await settleInput();
    view.stdin.write("\u001B[B\r");
    await vi.waitFor(() => {
      expect(view.lastFrame()).toContain("Missing coding CLIs");
    });

    await settleInput();
    view.stdin.write(" \r");
    await vi.waitFor(() => {
      const frame = view.lastFrame();
      expect(frame).toContain("Review installation commands");
      expect(frame).toContain("npm install --global @anthropic-ai/claude-code");
      expect(frame).not.toContain("npm install --global @openai/codex");
      expect(frame).not.toContain("npm install --global opencode-ai");
      expect(frame).not.toContain("aider.chat/install");
    });

    await settleInput();
    view.stdin.write("y");
    await vi.waitFor(() => {
      expect(installTools).toHaveBeenCalledOnce();
      expect(installTools).toHaveBeenCalledWith(["claude"]);
      expect(view.lastFrame()).toContain("Installation results");
    });
  });
});
