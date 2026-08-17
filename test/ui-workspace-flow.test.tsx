import React from "react";
import { cleanup, render } from "ink-testing-library";
import { afterEach, describe, expect, it, vi } from "vitest";

import { App } from "../src/ui/App.js";
import { Workspace } from "../src/ui/Workspace.js";
import type { KhapimanController, UiSnapshot } from "../src/ui/types.js";
import type { RelayProfile, ToolStatus } from "../src/types.js";

afterEach(() => {
  cleanup();
});

const profile: RelayProfile = {
  id: "primary",
  name: "Primary API",
  baseUrl: "https://api.khaix.net",
  protocols: ["openai-responses", "openai-chat", "anthropic-messages"],
  model: "relay-fast",
  secretId: "profile-primary",
  createdAt: "2026-08-17T00:00:00.000Z",
  updatedAt: "2026-08-17T00:00:00.000Z",
};

const statuses: ToolStatus[] = [
  {
    id: "codex",
    label: "Codex CLI",
    installed: true,
    configured: true,
    configPath: "/home/test/.codex/config.toml",
  },
  {
    id: "claude",
    label: "Claude Code",
    installed: true,
    configured: false,
    configPath: "/home/test/.claude/settings.json",
  },
  {
    id: "opencode",
    label: "OpenCode",
    installed: false,
    configured: false,
    configPath: "/home/test/.config/opencode/opencode.jsonc",
  },
  {
    id: "aider",
    label: "Aider",
    installed: false,
    configured: false,
    configPath: "/home/test/.aider.conf.yml",
  },
];

function snapshot(): UiSnapshot {
  return {
    state: { schemaVersion: 1, profiles: [profile], bindings: {} },
    statuses,
    transactions: [
      {
        id: "tx-20260817",
        createdAt: "2026-08-17T00:00:00.000Z",
        files: [],
        status: "applied",
      },
    ],
    secretBackend: "OS credential vault",
    secretBackendSecure: true,
  };
}

function controller(overrides: Partial<KhapimanController> = {}) {
  const data = snapshot();
  const unexpected = async (): Promise<never> => {
    throw new Error("Unexpected controller call");
  };
  return {
    snapshot: vi.fn(async () => data),
    detectTools: vi.fn(async () => data.statuses),
    installTools: vi.fn(async () => []),
    fetchModels: unexpected,
    createProfile: unexpected,
    deleteProfile: unexpected,
    previewApply: unexpected,
    apply: unexpected,
    doctor: vi.fn(async () => []),
    testConnection: vi.fn(async () => []),
    rollback: unexpected,
    ...overrides,
  } satisfies KhapimanController;
}

async function settle(): Promise<void> {
  await new Promise<void>((resolve) => setTimeout(resolve, 25));
}

async function openWorkspace(view: ReturnType<typeof render>): Promise<void> {
  await vi.waitFor(() =>
    expect(view.lastFrame()).toContain(
      "Choose interface language / 请选择界面语言",
    ),
  );
  await settle();
  view.stdin.write("\r");
  await vi.waitFor(() => expect(view.lastFrame()).toContain("API Profiles"));
}

describe("workspace shell", () => {
  it("keeps navigation and contextual content in one full-screen surface", async () => {
    const onAction = vi.fn();
    const view = render(
      <Workspace
        ascii
        locale="en"
        snapshot={snapshot()}
        width={80}
        onAction={onAction}
      />,
    );

    expect(view.lastFrame()).toContain("Overview");
    expect(view.lastFrame()).toContain("Clients");
    await settle();
    view.stdin.write("\u001B[B");
    await vi.waitFor(() => expect(view.lastFrame()).toContain("Primary API"));
    view.stdin.write("\r");
    await vi.waitFor(() => expect(onAction).toHaveBeenCalledWith("profiles"));
  });

  it("uses the compact layout without overflowing a narrow terminal", () => {
    const output = render(
      <Workspace
        ascii
        locale="en"
        snapshot={snapshot()}
        width={40}
        onAction={() => undefined}
      />,
    ).lastFrame();

    expect(output).toContain("Overview");
    expect(output).toContain("API Profiles");
    expect((output ?? "").split("\n").every((line) => line.length <= 40)).toBe(
      true,
    );
  });

  it("runs diagnostics from the Doctor navigation item", async () => {
    const doctor = vi.fn(async () => [
      {
        id: "runtime",
        label: "Node.js runtime",
        status: "pass" as const,
        detail: "Node 24",
      },
    ]);
    const view = render(
      <App controller={controller({ doctor })} ascii initialLocale="en" />,
    );
    await openWorkspace(view);
    await settle();
    view.stdin.write("\u001B[B\u001B[B\u001B[B\u001B[B\r");

    await vi.waitFor(() => {
      expect(doctor).toHaveBeenCalledOnce();
      expect(view.lastFrame()).toContain("Node.js runtime: Node 24");
    });
  });

  it("restores a selected transaction only after confirmation", async () => {
    const rollback = vi.fn(async () => undefined);
    const view = render(
      <App controller={controller({ rollback })} ascii initialLocale="en" />,
    );
    await openWorkspace(view);
    await settle();
    view.stdin.write("\u001B[B\u001B[B\u001B[B\r");
    await vi.waitFor(() =>
      expect(view.lastFrame()).toContain("Transaction to restore"),
    );
    await settle();
    view.stdin.write("\r");
    await vi.waitFor(() =>
      expect(view.lastFrame()).toContain("Restore this transaction?"),
    );
    await settle();
    view.stdin.write("y");

    await vi.waitFor(() => {
      expect(rollback).toHaveBeenCalledWith("tx-20260817");
      expect(view.lastFrame()).toContain("Restored transaction tx-20260817");
    });
  });

  it("removes a profile through the profile action menu", async () => {
    const deleteProfile = vi.fn(async () => undefined);
    const view = render(
      <App
        controller={controller({ deleteProfile })}
        ascii
        initialLocale="en"
      />,
    );
    await openWorkspace(view);
    await settle();
    view.stdin.write("\u001B[B\r");
    await vi.waitFor(() =>
      expect(view.lastFrame()).toContain("API profile actions"),
    );
    await settle();
    view.stdin.write("\u001B[B\u001B[B\r");
    await vi.waitFor(() => expect(view.lastFrame()).toContain("Primary API"));
    await settle();
    view.stdin.write("\r");
    await vi.waitFor(() =>
      expect(view.lastFrame()).toContain("Remove Primary API?"),
    );
    await settle();
    view.stdin.write("y");

    await vi.waitFor(() => {
      expect(deleteProfile).toHaveBeenCalledWith("primary");
      expect(view.lastFrame()).toContain("Relay profile removed.");
    });
  });
});
