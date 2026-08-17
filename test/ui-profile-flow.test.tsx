import React from "react";
import { cleanup, render } from "ink-testing-library";
import { afterEach, describe, expect, it, vi } from "vitest";

import type {
  ApplyPreview,
  KhapimanController,
  UiSnapshot,
} from "../src/ui/types.js";
import { App } from "../src/ui/App.js";
import type { RelayProfile, ToolId, ToolStatus } from "../src/types.js";

afterEach(() => {
  cleanup();
});

function status(id: ToolId, label: string): ToolStatus {
  return {
    id,
    label,
    installed: true,
    configured: false,
    configPath: `/home/test/.config/${id}`,
  };
}

function baseSnapshot(profiles: RelayProfile[] = []): UiSnapshot {
  return {
    state: { schemaVersion: 1, profiles, bindings: {} },
    statuses: [
      status("codex", "Codex CLI"),
      status("claude", "Claude Code"),
      status("opencode", "OpenCode"),
      status("aider", "Aider"),
    ],
    transactions: [],
    secretBackend: "OS credential vault",
    secretBackendSecure: true,
  };
}

async function settleInput(): Promise<void> {
  await new Promise<void>((resolve) => setTimeout(resolve, 25));
}

async function enterHome(view: ReturnType<typeof render>): Promise<void> {
  await vi.waitFor(() =>
    expect(view.lastFrame()).toContain(
      "Choose interface language / 请选择界面语言",
    ),
  );
  await settleInput();
  view.stdin.write("\r");
  await vi.waitFor(() => expect(view.lastFrame()).toContain("API Profiles"));
}

function controllerFor(
  snapshot: UiSnapshot,
  overrides: Partial<KhapimanController> = {},
): KhapimanController {
  const unexpected = async (): Promise<never> => {
    throw new Error("Unexpected controller call");
  };
  return {
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
    ...overrides,
  };
}

describe("API configuration flow", () => {
  it("offers retry or exit when the initial snapshot fails", async () => {
    const snapshot = baseSnapshot();
    const loadSnapshot = vi
      .fn<() => Promise<UiSnapshot>>()
      .mockRejectedValueOnce(
        new Error("\u001b]0;FORGED\u0007Unable to scan\ntry again"),
      )
      .mockResolvedValue(snapshot);
    const controller = controllerFor(snapshot, { snapshot: loadSnapshot });
    const view = render(
      <App controller={controller} ascii initialLocale="en" />,
    );

    await vi.waitFor(() => {
      const frame = view.lastFrame();
      expect(frame).toContain("Unable to scan try again");
      expect(frame).toContain("Retry");
      expect(frame).toContain("Exit");
      expect(frame).not.toContain("FORGED");
    });
    await settleInput();
    view.stdin.write("\r");
    await vi.waitFor(() =>
      expect(view.lastFrame()).toContain(
        "Choose interface language / 请选择界面语言",
      ),
    );
    expect(loadSnapshot).toHaveBeenCalledTimes(2);
  });

  it("fetches models after the key and persists the selected model", async () => {
    const snapshot = baseSnapshot();
    const createdProfile: RelayProfile = {
      id: "demo-relay",
      name: "Demo Relay",
      baseUrl: "https://api.khaix.net",
      protocols: ["openai-responses", "openai-chat", "anthropic-messages"],
      model: "relay-pro",
      secretId: "demo-secret",
      createdAt: "2026-08-14T00:00:00.000Z",
      updatedAt: "2026-08-14T00:00:00.000Z",
    };
    const fetchModels = vi.fn(async () => ["relay-fast", "relay-pro"]);
    const createProfile = vi.fn(async () => createdProfile);
    const controller = controllerFor(snapshot, { fetchModels, createProfile });
    const view = render(
      <App controller={controller} ascii initialLocale="en" />,
    );

    await enterHome(view);
    await settleInput();
    view.stdin.write("\u001B[B\r");
    await vi.waitFor(() =>
      expect(view.lastFrame()).toContain("API profile actions"),
    );
    await settleInput();
    view.stdin.write("\r");
    await vi.waitFor(() =>
      expect(view.lastFrame()).toContain("API configuration name"),
    );

    await settleInput();
    view.stdin.write("Demo Relay");
    await settleInput();
    view.stdin.write("\r");
    await vi.waitFor(() => expect(view.lastFrame()).toContain("Relay API key"));

    await settleInput();
    view.stdin.write("secret-value");
    await settleInput();
    view.stdin.write("\r");
    await vi.waitFor(() =>
      expect(view.lastFrame()).toContain("Choose a model (2 available)"),
    );
    expect(fetchModels).toHaveBeenCalledWith("secret-value");
    expect(view.lastFrame()).not.toContain("secret-value");

    await settleInput();
    view.stdin.write("\u001B[B\r");
    await vi.waitFor(() =>
      expect(createProfile).toHaveBeenCalledWith({
        name: "Demo Relay",
        protocols: ["openai-responses", "openai-chat", "anthropic-messages"],
        secret: "secret-value",
        model: "relay-pro",
      }),
    );
    await vi.waitFor(() =>
      expect(view.lastFrame()).toContain(
        "Profile “Demo Relay” is ready with model relay-pro.",
      ),
    );
  });

  it("uses Escape to return from model selection to the key step", async () => {
    const snapshot = baseSnapshot();
    const controller = controllerFor(snapshot, {
      fetchModels: vi.fn(async () => ["relay-fast"]),
    });
    const view = render(
      <App controller={controller} ascii initialLocale="en" />,
    );

    await enterHome(view);
    await settleInput();
    view.stdin.write("\u001B[B\r");
    await vi.waitFor(() =>
      expect(view.lastFrame()).toContain("API profile actions"),
    );
    await settleInput();
    view.stdin.write("\r");
    await vi.waitFor(() =>
      expect(view.lastFrame()).toContain("API configuration name"),
    );
    await settleInput();
    view.stdin.write("Back test");
    await settleInput();
    view.stdin.write("\r");
    await vi.waitFor(() => expect(view.lastFrame()).toContain("Relay API key"));
    await settleInput();
    view.stdin.write("secret");
    await settleInput();
    view.stdin.write("\r");
    await vi.waitFor(() =>
      expect(view.lastFrame()).toContain("Choose a model"),
    );
    await settleInput();
    view.stdin.write("\u001B");
    await vi.waitFor(() => expect(view.lastFrame()).toContain("Relay API key"));
  });
});

describe("CLI assignment flow", () => {
  it("selects a CLI first, then applies its chosen API profile", async () => {
    const profile: RelayProfile = {
      id: "primary",
      name: "Primary API",
      baseUrl: "https://api.khaix.net",
      protocols: ["openai-responses", "openai-chat", "anthropic-messages"],
      model: "relay-fast",
      secretId: "primary-secret",
      createdAt: "2026-08-14T00:00:00.000Z",
      updatedAt: "2026-08-14T00:00:00.000Z",
    };
    const snapshot = baseSnapshot([profile]);
    const preview: ApplyPreview = {
      planId: "plan-1",
      profileId: profile.id,
      tools: ["codex"],
      model: "relay-fast",
      diff: "config.toml",
      fileCount: 1,
      notes: [],
    };
    const previewApply = vi.fn(async () => preview);
    const apply = vi.fn(async () => ({
      transactionId: "tx-1",
      tools: ["codex" as const],
    }));
    const controller = controllerFor(snapshot, { previewApply, apply });
    const view = render(
      <App controller={controller} ascii initialLocale="en" />,
    );

    await enterHome(view);
    await settleInput();
    view.stdin.write("\u001B[B\u001B[B\r");
    await vi.waitFor(() =>
      expect(view.lastFrame()).toContain("Client actions"),
    );
    await settleInput();
    view.stdin.write("\r");
    await vi.waitFor(() => expect(view.lastFrame()).toContain("Choose a CLI"));
    await settleInput();
    view.stdin.write("\r");
    await vi.waitFor(() =>
      expect(view.lastFrame()).toContain("Choose an API for Codex CLI"),
    );
    await settleInput();
    view.stdin.write("\r");
    await vi.waitFor(() =>
      expect(view.lastFrame()).toContain("Review changes"),
    );
    expect(previewApply).toHaveBeenCalledWith(
      "primary",
      ["codex"],
      "relay-fast",
    );

    await settleInput();
    view.stdin.write("y");
    await vi.waitFor(() => expect(apply).toHaveBeenCalledWith(preview));
    await vi.waitFor(() =>
      expect(view.lastFrame()).toContain("Applied to Codex CLI"),
    );
  });

  it("cancels abandoned previews and returns to rebuild after apply fails", async () => {
    const profile: RelayProfile = {
      id: "primary",
      name: "Primary API",
      baseUrl: "https://api.khaix.net",
      protocols: ["openai-responses"],
      model: "relay-fast",
      secretId: "primary-secret",
      createdAt: "2026-08-14T00:00:00.000Z",
      updatedAt: "2026-08-14T00:00:00.000Z",
    };
    const snapshot = baseSnapshot([profile]);
    const longDiff = `start ${"x".repeat(100)} FINAL-CHANGE`;
    const firstPreview: ApplyPreview = {
      planId: "plan-1",
      profileId: profile.id,
      tools: ["codex"],
      model: "relay-fast",
      diff: longDiff,
      fileCount: 1,
      notes: [],
    };
    const secondPreview: ApplyPreview = {
      ...firstPreview,
      planId: "plan-2",
    };
    const previewApply = vi
      .fn()
      .mockResolvedValueOnce(firstPreview)
      .mockResolvedValueOnce(secondPreview);
    const apply = vi.fn(async () => {
      throw new Error("\u001b]0;FORGED\u0007File changed\nrebuild preview");
    });
    const cancelApply = vi.fn();
    const controller = controllerFor(snapshot, {
      previewApply,
      apply,
      cancelApply,
    });
    const view = render(
      <App
        controller={controller}
        ascii
        initialLocale="en"
        terminalWidth={60}
      />,
    );

    await enterHome(view);
    await settleInput();
    view.stdin.write("\u001B[B\u001B[B\r");
    await vi.waitFor(() =>
      expect(view.lastFrame()).toContain("Client actions"),
    );
    await settleInput();
    view.stdin.write("\r");
    await vi.waitFor(() => expect(view.lastFrame()).toContain("Choose a CLI"));
    await settleInput();
    view.stdin.write("\r");
    await vi.waitFor(() =>
      expect(view.lastFrame()).toContain("Choose an API for Codex CLI"),
    );
    await settleInput();
    view.stdin.write("\r");
    await vi.waitFor(() => {
      expect(view.lastFrame()).toContain("Review changes");
      expect(view.lastFrame()).toContain("FINAL-CHANGE");
    });

    await settleInput();
    view.stdin.write("\u001B");
    await vi.waitFor(() =>
      expect(view.lastFrame()).toContain("Choose an API for Codex CLI"),
    );
    expect(cancelApply).toHaveBeenCalledWith("plan-1");

    await settleInput();
    view.stdin.write("\r");
    await vi.waitFor(() =>
      expect(view.lastFrame()).toContain("Review changes"),
    );
    await settleInput();
    view.stdin.write("y");
    await vi.waitFor(() => {
      const frame = view.lastFrame();
      expect(frame).toContain("Choose an API for Codex CLI");
      expect(frame).toContain("File changed rebuild preview");
      expect(frame).not.toContain("FORGED");
      expect(frame).not.toContain("FINAL-CHANGE");
    });
    expect(apply).toHaveBeenCalledWith(secondPreview);
    expect(cancelApply).toHaveBeenCalledWith("plan-2");
  });
});
