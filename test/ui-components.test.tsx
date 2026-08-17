import React from "react";
import { cleanup, render } from "ink-testing-library";
import { afterEach, describe, expect, it } from "vitest";

import { Dashboard } from "../src/ui/Dashboard.js";
import { Header } from "../src/ui/Header.js";
import { APP_VERSION, RELAY_BASE_URL } from "../src/constants.js";
import packageMetadata from "../package.json" with { type: "json" };
import type { AppState, RelayProfile, ToolStatus } from "../src/types.js";

afterEach(() => {
  cleanup();
});

describe("Header", () => {
  it("renders a compact Unicode code-style title", () => {
    const output = render(<Header width={100} />).lastFrame();
    const lines = (output ?? "").split("\n");
    const contentLines = lines.filter(Boolean);

    expect(output).toContain("›_ KHapiMAN");
    expect(output).toContain(`v${packageMetadata.version}`);
    expect(contentLines).toHaveLength(1);
    expect(output).toContain("KHaiXAPI client control");
    expect(output).not.toContain("█");
    expect(output).not.toContain("╭");
  });

  it("uses an entirely ASCII-safe title when requested", () => {
    const forcedAscii = render(<Header width={100} ascii />).lastFrame();

    expect(forcedAscii).toContain(">_ KHapiMAN");
    expect(forcedAscii).toContain("KHaiXAPI client control");
    expect(forcedAscii).not.toContain("█");
    expect(
      [...(forcedAscii ?? "")].every(
        (character) => character.charCodeAt(0) < 128,
      ),
    ).toBe(true);
  });
});

describe("product contract", () => {
  it("bundles the KHaiXAPI relay endpoint", () => {
    expect(RELAY_BASE_URL).toBe("https://api.khaix.net");
  });

  it("derives the CLI version from package metadata", () => {
    expect(APP_VERSION).toBe(packageMetadata.version);
  });
});

describe("Dashboard", () => {
  it("shows tool detection, active profile and secret backend status", () => {
    const activeProfile: RelayProfile = {
      id: "team-relay",
      name: "Team Relay",
      baseUrl: "https://relay.example.com/v1",
      protocols: ["openai-responses"],
      secretId: "profile-secret-123",
      createdAt: "2026-08-14T00:00:00.000Z",
      updatedAt: "2026-08-14T00:00:00.000Z",
    };
    const state: AppState = {
      schemaVersion: 1,
      profiles: [activeProfile],
      bindings: {
        codex: {
          tool: "codex",
          profileId: activeProfile.id,
          model: "gpt-5-codex",
          appliedAt: "2026-08-14T00:00:00.000Z",
        },
      },
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
        installed: false,
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

    const output = render(
      <Dashboard
        state={state}
        statuses={statuses}
        secretBackend="Windows Credential Manager"
        secretBackendSecure
      />,
    ).lastFrame();

    expect(output).toContain("1/4 installed");
    expect(output).toContain("Codex CLI");
    expect(output).toContain("Ready");
    expect(output).toContain("Team Relay");
    expect(output).toContain("Claude Code");
    expect(output).toContain("×");
    expect(output).not.toContain("MISSING");
    expect(output).toContain("Not configured");
    expect(output).toContain("Protected");
    expect(output).toContain("Windows Credential Manager");
  });

  it("marks a saved binding for re-apply when its client config is stale", () => {
    const activeProfile: RelayProfile = {
      id: "legacy-relay",
      name: "Legacy Relay",
      baseUrl: RELAY_BASE_URL,
      protocols: ["openai-responses"],
      secretId: "profile-secret-legacy",
      createdAt: "2026-08-14T00:00:00.000Z",
      updatedAt: "2026-08-14T00:00:00.000Z",
    };
    const state: AppState = {
      schemaVersion: 1,
      profiles: [activeProfile],
      bindings: {
        codex: {
          tool: "codex",
          profileId: activeProfile.id,
          model: "gpt-5-codex",
          appliedAt: "2026-08-14T00:00:00.000Z",
        },
      },
    };
    const statuses: ToolStatus[] = [
      {
        id: "codex",
        label: "Codex CLI",
        installed: true,
        configured: false,
        configPath: "/home/test/.codex/config.toml",
      },
    ];

    const output = render(
      <Dashboard
        state={state}
        statuses={statuses}
        secretBackend="OS credential vault"
        secretBackendSecure
      />,
    ).lastFrame();

    expect(output).toContain("Reapply");
    expect(output).toContain("Needs re-apply: Legacy Relay");
  });

  it("uses installed and missing status wording in Chinese", () => {
    const output = render(
      <Dashboard
        locale="zh-CN"
        ascii={false}
        state={{ schemaVersion: 1, profiles: [], bindings: {} }}
        statuses={[
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
        ]}
        secretBackend="OS credential vault"
        secretBackendSecure
      />,
    ).lastFrame();

    expect(output).toContain("已安装 1/4");
    expect(output).toContain("已安装");
    expect(output).toContain("×");
    expect(output).not.toContain("已检测");
    expect(output).not.toContain("缺失");
  });

  it("fits narrow terminals and removes control sequences from state", () => {
    const profile: RelayProfile = {
      id: "narrow",
      name: "A very long profile name that must stay inside the terminal",
      baseUrl: RELAY_BASE_URL,
      protocols: ["openai-responses"],
      secretId: "profile-narrow",
      createdAt: "2026-08-14T00:00:00.000Z",
      updatedAt: "2026-08-14T00:00:00.000Z",
    };
    const output = render(
      <Dashboard
        width={24}
        state={{
          schemaVersion: 1,
          profiles: [profile],
          bindings: {
            codex: {
              tool: "codex",
              profileId: profile.id,
              model: "relay-model",
              appliedAt: "2026-08-14T00:00:00.000Z",
            },
          },
        }}
        statuses={[
          {
            id: "codex",
            label: "\u001b]0;FORGED\u0007Codex CLI with a long label",
            installed: true,
            configured: true,
            configPath: "/home/test/.codex/config.toml",
          },
        ]}
        secretBackend={"\u001b]0;HIJACKED\u0007OS credential vault"}
        secretBackendSecure
      />,
    ).lastFrame();

    expect(output).not.toContain("FORGED");
    expect(output).not.toContain("HIJACKED");
    expect((output ?? "").split("\n").every((line) => line.length <= 24)).toBe(
      true,
    );
  });
});
