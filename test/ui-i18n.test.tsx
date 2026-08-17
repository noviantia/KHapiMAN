import React from "react";
import { cleanup, render } from "ink-testing-library";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { ToolId, ToolStatus } from "../src/types.js";
import { App } from "../src/ui/App.js";
import { Dashboard } from "../src/ui/Dashboard.js";
import { Header } from "../src/ui/Header.js";
import { detectUiLocale, uiMessage } from "../src/ui/i18n.js";
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

function controllerFor(snapshot: UiSnapshot): KhapimanController {
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
  };
}

async function settleInput(): Promise<void> {
  await new Promise<void>((resolve) => setTimeout(resolve, 25));
}

describe("UI locale selection", () => {
  it("detects a reasonable default from environment and runtime locales", () => {
    expect(detectUiLocale({ LANG: "zh_CN.UTF-8" }, "en-US")).toBe("zh-CN");
    expect(detectUiLocale({ LC_ALL: "C", LANG: "zh_CN.UTF-8" }, "zh-CN")).toBe(
      "en",
    );
    expect(detectUiLocale({}, "zh-Hans-CN")).toBe("zh-CN");
    expect(detectUiLocale({ LANGUAGE: "zh_CN:en" }, "en-US")).toBe("zh-CN");
    expect(detectUiLocale({}, "en-GB")).toBe("en");
  });

  it("selects Chinese at startup and renders the localized dashboard", async () => {
    const statuses = [
      status("codex", "Codex CLI", true),
      status("claude", "Claude Code", false),
      status("opencode", "OpenCode", false),
      status("aider", "Aider", false),
    ];
    const snapshot: UiSnapshot = {
      state: { schemaVersion: 1, profiles: [], bindings: {} },
      statuses,
      transactions: [],
      secretBackend: "OS credential vault",
      secretBackendSecure: true,
    };
    const view = render(
      <App controller={controllerFor(snapshot)} ascii initialLocale="zh-CN" />,
    );

    await vi.waitFor(() => {
      expect(view.lastFrame()).toContain(
        "请选择界面语言 / Choose interface language",
      );
      expect(view.lastFrame()).toContain("中文（简体）");
      expect(view.lastFrame()).toContain("English");
    });

    await settleInput();
    view.stdin.write("\r");
    await vi.waitFor(() => {
      const frame = view.lastFrame();
      expect(frame).toContain("API 配置");
      expect(frame).toContain("客户端");
      expect(frame).toContain("已安装 1/4");
      expect(frame).toContain("密钥");
      expect(frame).not.toContain("Install missing coding CLIs");
    });
  });
});

describe("localized UI components", () => {
  it("translates Header and Dashboard copy without changing dynamic values", () => {
    const header = render(<Header locale="zh-CN" width={100} />).lastFrame();
    expect(header).toContain("KHaiXAPI 客户端控制台");

    const dashboard = render(
      <Dashboard
        locale="zh-CN"
        state={{ schemaVersion: 1, profiles: [], bindings: {} }}
        statuses={[status("codex", "Codex CLI", false)]}
        secretBackend="OS credential vault"
        secretBackendSecure={false}
      />,
    ).lastFrame();
    expect(dashboard).toContain("工具");
    expect(dashboard).toContain("×");
    expect(dashboard).toContain("未配置");
    expect(dashboard).toContain("备用存储");
    expect(dashboard).toContain("OS credential vault");
  });

  it("interpolates translated UI copy while preserving machine identifiers", () => {
    expect(
      uiMessage("zh-CN", "apply.complete", {
        tools: "Codex CLI",
        id: "tx-2026-08-14_001",
      }),
    ).toBe("已应用到 Codex CLI。回滚 ID：tx-2026-08-14_001");
  });
});
