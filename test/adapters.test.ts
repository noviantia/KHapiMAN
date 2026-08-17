import { parse as parseJsonc } from "jsonc-parser";
import { parse as parseYaml } from "yaml";
import { describe, expect, it } from "vitest";

import { renderAiderConfig } from "../src/adapters/aider.js";
import { renderClaudeConfig } from "../src/adapters/claude.js";
import { renderCodexConfig } from "../src/adapters/codex.js";
import {
  openCodeAdapter,
  renderOpenCodeConfig,
  renderOpenCodeRuntimeConfig,
} from "../src/adapters/opencode.js";
import { aiderAdapter } from "../src/adapters/aider.js";
import { claudeAdapter } from "../src/adapters/claude.js";
import { mergeAdapterEnvironment } from "../src/adapters/types.js";
import type { RelayProfile, RelayProtocol } from "../src/types.js";

function profile(protocols: RelayProtocol[]): RelayProfile {
  return {
    id: "team-relay",
    name: "Team Relay",
    baseUrl: "https://relay.example.com/v1",
    protocols,
    secretId: "profile-secret-123",
    createdAt: "2026-08-14T00:00:00.000Z",
    updatedAt: "2026-08-14T00:00:00.000Z",
  };
}

describe("Codex adapter rendering", () => {
  it("preserves unrelated TOML, uses Responses and remains idempotent", () => {
    const source = [
      "# User-owned heading",
      'model = "old-model" # keep this note',
      'model_provider = "openai"',
      'approval_policy = "on-request"',
      "",
      "[features]",
      "web_search = true",
      "",
    ].join("\n");

    const relay = profile(["openai-responses"]);
    const rendered = renderCodexConfig(source, relay, "gpt-5-codex");

    expect(rendered).toContain("# User-owned heading");
    expect(rendered).toContain("# keep this note");
    expect(rendered).toContain('approval_policy = "on-request"');
    expect(rendered).toContain("[features]\nweb_search = true");
    expect(rendered).toContain('model = "gpt-5-codex"');
    expect(rendered).toContain('model_provider = "khapiman"');
    expect(rendered).toContain("[model_providers.khapiman]");
    expect(rendered).toContain('wire_api = "responses"');
    expect(rendered).toContain("[model_providers.khapiman.auth]");
    expect(rendered).toContain('command = "khapiman"');
    expect(rendered).toContain(
      'args = ["secret", "get", "profile-secret-123"]',
    );
    expect(rendered).not.toContain("api-key-value");
    expect(renderCodexConfig(rendered, relay, "gpt-5-codex")).toBe(rendered);
  });

  it("refuses to overwrite an unmanaged khapiman provider table", () => {
    const source = [
      'model = "gpt-5-codex"',
      "",
      "[model_providers.khapiman]",
      'base_url = "https://user-owned.example.com/v1"',
      "",
    ].join("\n");

    expect(() =>
      renderCodexConfig(source, profile(["openai-responses"]), "gpt-5-codex"),
    ).toThrow(/unmanaged \[model_providers\.khapiman\]/i);
  });
});

describe("Claude Code adapter rendering", () => {
  it("preserves JSONC comments and unknown settings while removing old keys", () => {
    const source = `{
  // User preference must survive
  "theme": "dark",
  "env": {
    "KEEP_ME": "yes",
    "ANTHROPIC_AUTH_TOKEN": "old-auth-secret",
    "ANTHROPIC_API_KEY": "old-api-secret",
  },
}
`;

    const rendered = renderClaudeConfig(
      source,
      profile(["anthropic-messages"]),
    );
    const parsed = parseJsonc(rendered) as {
      theme: string;
      env: Record<string, string>;
      apiKeyHelper: string;
    };

    expect(rendered).toContain("// User preference must survive");
    expect(parsed.theme).toBe("dark");
    expect(parsed.env.KEEP_ME).toBe("yes");
    expect(parsed.env.ANTHROPIC_BASE_URL).toBeUndefined();
    expect(parsed.env.KHAPIMAN_CLAUDE_PROFILE).toBe("team-relay");
    expect(parsed.env).not.toHaveProperty("ANTHROPIC_AUTH_TOKEN");
    expect(parsed.env).not.toHaveProperty("ANTHROPIC_API_KEY");
    expect(parsed.apiKeyHelper).toBeUndefined();
    expect(rendered).not.toContain("old-auth-secret");
    expect(rendered).not.toContain("old-api-secret");
  });

  it("provides the helper and endpoint only as highest-priority run settings", () => {
    const relay = profile(["anthropic-messages"]);
    expect(claudeAdapter.environment(relay, "secret-value")).toEqual({});
    expect(claudeAdapter.launchArgs?.(relay)).toEqual([
      "--settings",
      JSON.stringify({
        env: {
          ANTHROPIC_BASE_URL: relay.baseUrl,
          CLAUDE_CODE_USE_ANTHROPIC_AWS: "",
          CLAUDE_CODE_USE_BEDROCK: "",
          CLAUDE_CODE_USE_FOUNDRY: "",
          CLAUDE_CODE_USE_MANTLE: "",
          CLAUDE_CODE_USE_VERTEX: "",
        },
        apiKeyHelper: "khapiman secret get profile-secret-123",
      }),
    ]);

    const environment = mergeAdapterEnvironment(
      {
        PATH: "trusted-path",
        Anthropic_Api_Key: "ambient-api-key",
        ANTHROPIC_AUTH_TOKEN: "ambient-auth-token",
        ANTHROPIC_BASE_URL: "https://ambient.example.com",
        ANTHROPIC_CUSTOM_HEADERS: "X-Secret: ambient-header",
        CLAUDE_CODE_OAUTH_TOKEN: "ambient-oauth-token",
        CLAUDE_CODE_USE_BEDROCK: "1",
      },
      claudeAdapter.environment(relay, "secret-value"),
      claudeAdapter.unsetEnvironment,
      "win32",
    );
    expect(environment).toEqual({ PATH: "trusted-path" });
  });
});

describe("OpenCode adapter rendering", () => {
  it("adds a provider, selected model and env reference without a plaintext key", () => {
    const source = `{
  // Keep this plugin configuration
  "plugin": ["example-plugin"],
}
`;

    const rendered = renderOpenCodeConfig(
      source,
      profile(["openai-chat"]),
      "gpt-5-mini",
    );
    const parsed = parseJsonc(rendered) as {
      plugin: string[];
      model: string;
      provider: Record<
        string,
        {
          npm: string;
          options: { baseURL: string; apiKey: string };
          models: Record<string, { name: string }>;
        }
      >;
    };
    const provider = parsed.provider.khapiman;

    expect(rendered).toContain("// Keep this plugin configuration");
    expect(parsed.plugin).toEqual(["example-plugin"]);
    expect(parsed.model).toBe("khapiman/gpt-5-mini");
    expect(provider?.npm).toBe("@ai-sdk/openai-compatible");
    expect(provider?.options.baseURL).toBe("https://relay.example.com/v1");
    expect(provider?.options.apiKey).toBe("{env:KHAPIMAN_API_KEY_TEAM_RELAY}");
    expect(provider?.models).toEqual({
      "gpt-5-mini": { name: "gpt-5-mini" },
    });
    expect(rendered).not.toContain("api-key-value");
  });

  it("refuses to overwrite an unmanaged provider with the same ID", () => {
    const source = `{
  "provider": {
    "khapiman": { "name": "User-owned provider" }
  }
}`;

    expect(() =>
      renderOpenCodeConfig(source, profile(["openai-chat"]), "gpt-5-mini"),
    ).toThrow("is not managed by KHapiMAN");
  });

  it("pins the runtime provider through OpenCode's inline override", () => {
    const relay = profile(["openai-chat"]);
    const runtime = JSON.parse(
      renderOpenCodeRuntimeConfig(relay, "gpt-5-mini"),
    ) as {
      model: string;
      provider: {
        khapiman: { options: { baseURL: string; apiKey: string } };
      };
    };
    expect(runtime.model).toBe("khapiman/gpt-5-mini");
    expect(runtime.provider.khapiman.options).toEqual({
      baseURL: relay.baseUrl,
      apiKey: "{env:KHAPIMAN_API_KEY_TEAM_RELAY}",
    });
    expect(
      openCodeAdapter.environment(relay, "secret-value", "gpt-5-mini"),
    ).toMatchObject({
      KHAPIMAN_API_KEY_TEAM_RELAY: "secret-value",
      OPENCODE_CONFIG_CONTENT: expect.any(String),
    });
  });
});

describe("Aider adapter rendering", () => {
  it("preserves comments and unrelated keys while removing a stored key", () => {
    const source = [
      "# User-owned Aider settings",
      "dark-mode: true",
      "openai-api-key: old-plaintext-secret",
      "model: openai/old-model",
      "",
    ].join("\n");

    const rendered = renderAiderConfig(source, profile(["openai-chat"]));
    const parsed = parseYaml(rendered) as Record<string, unknown>;

    expect(rendered).toContain("# User-owned Aider settings");
    expect(parsed["dark-mode"]).toBe(true);
    expect(rendered).toContain("# >>> KHapiMAN Aider profile: team-relay");
    expect(parsed).not.toHaveProperty("openai-api-base");
    expect(parsed).not.toHaveProperty("model");
    expect(parsed).not.toHaveProperty("openai-api-key");
    expect(rendered).not.toContain("old-plaintext-secret");
  });

  it("pins base URL and model with command-line precedence when launched", () => {
    const relay = profile(["openai-chat"]);
    expect(
      aiderAdapter.environment(relay, "profile-secret", "gpt-5-mini"),
    ).toMatchObject({
      AIDER_OPENAI_API_BASE: relay.baseUrl,
      AIDER_OPENAI_API_KEY: "profile-secret",
      OPENAI_API_BASE: relay.baseUrl,
      OPENAI_API_KEY: "profile-secret",
      AIDER_MODEL: "openai/gpt-5-mini",
    });
    expect(aiderAdapter.launchArgs?.(relay, "gpt-5-mini")).toEqual([
      "--openai-api-base",
      relay.baseUrl,
      "--model",
      "openai/gpt-5-mini",
    ]);
  });
});
