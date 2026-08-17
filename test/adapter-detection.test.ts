import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { ADAPTERS } from "../src/adapters/index.js";
import { RELAY_BASE_URL } from "../src/constants.js";
import { resolveRuntimePaths } from "../src/paths.js";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("managed endpoint detection", () => {
  it("does not treat a legacy managed URL as a current configuration", async () => {
    const root = await mkdtemp(join(tmpdir(), "khapiman-detect-"));
    roots.push(root);
    const paths = resolveRuntimePaths({ homeDir: root, env: {} });
    const previousCodexHome = process.env.CODEX_HOME;
    process.env.CODEX_HOME = join(root, ".codex");
    const configs: Record<string, string> = {
      codex: [
        "# >>> KHapiMAN provider (managed; use khapiman rollback to restore)",
        "[model_providers.khapiman]",
        'name = "KHapiman: Legacy"',
        'base_url = "https://legacy.example.com/v1"',
        'wire_api = "responses"',
        "",
        "[model_providers.khapiman.auth]",
        'command = "khapiman"',
        'args = ["secret", "get", "profile-secret"]',
        "# <<< KHapiman provider",
      ].join("\n"),
      claude: JSON.stringify({
        env: {
          KHAPIMAN_CLAUDE_PROFILE: "profile-secret",
          ANTHROPIC_BASE_URL: "https://legacy.example.com/v1",
        },
      }),
      opencode: JSON.stringify({
        model: "khapiman/gpt-5",
        provider: {
          khapiman: {
            name: "KHapiman: Legacy",
            npm: "@ai-sdk/openai-compatible",
            options: {
              baseURL: "https://legacy.example.com/v1",
              apiKey: "{env:KHAPIMAN_API_KEY_TEAM_RELAY}",
            },
            models: { "gpt-5": { name: "gpt-5" } },
          },
        },
      }),
      aider: [
        "# >>> KHapiman Aider profile: profile-secret",
        "openai-api-base: https://legacy.example.com/v1",
        "model: openai/gpt-5",
      ].join("\n"),
    };

    try {
      for (const adapter of ADAPTERS) {
        const configPath = await adapter.configPath(paths);
        await mkdir(join(configPath, ".."), { recursive: true });
        await writeFile(configPath, configs[adapter.id] ?? "", "utf8");
        await expect(adapter.detect(paths)).resolves.toMatchObject({
          id: adapter.id,
          configured: false,
        });
      }
    } finally {
      if (previousCodexHome === undefined) delete process.env.CODEX_HOME;
      else process.env.CODEX_HOME = previousCodexHome;
    }
  });

  it("recognizes the fixed endpoint in each managed format", async () => {
    const root = await mkdtemp(join(tmpdir(), "khapiman-detect-"));
    roots.push(root);
    const paths = resolveRuntimePaths({ homeDir: root, env: {} });
    const previousCodexHome = process.env.CODEX_HOME;
    process.env.CODEX_HOME = join(root, ".codex");
    const configs: Record<string, string> = {
      codex: [
        "# >>> KHapiman provider (managed; use khapiman rollback to restore)",
        "[model_providers.khapiman]",
        'name = "KHapiMAN: Current"',
        `base_url = ${JSON.stringify(RELAY_BASE_URL)}`,
        'wire_api = "responses"',
        "",
        "[model_providers.khapiman.auth]",
        'command = "khapiman"',
        'args = ["secret", "get", "profile-secret"]',
        "# <<< KHapiMAN provider",
      ].join("\n"),
      claude: JSON.stringify({
        env: { KHAPIMAN_CLAUDE_PROFILE: "profile-secret" },
      }),
      opencode: JSON.stringify({
        model: "khapiman/gpt-5",
        provider: {
          khapiman: {
            name: "KHapiMAN: Current",
            npm: "@ai-sdk/openai-compatible",
            options: {
              baseURL: RELAY_BASE_URL,
              apiKey: "{env:KHAPIMAN_API_KEY_TEAM_RELAY}",
            },
            models: { "gpt-5": { name: "gpt-5" } },
          },
        },
      }),
      aider: "# >>> KHapiMAN Aider profile: profile-secret\n",
    };

    try {
      for (const adapter of ADAPTERS) {
        const configPath = await adapter.configPath(paths);
        await mkdir(join(configPath, ".."), { recursive: true });
        await writeFile(configPath, configs[adapter.id] ?? "", "utf8");
        await expect(adapter.detect(paths)).resolves.toMatchObject({
          id: adapter.id,
          configured: true,
        });
      }

      for (const adapter of ADAPTERS) {
        const configPath = await adapter.configPath(paths);
        await writeFile(
          configPath,
          (configs[adapter.id] ?? "").replaceAll("KHapiMAN", "KHapiman"),
          "utf8",
        );
        await expect(adapter.detect(paths)).resolves.toMatchObject({
          id: adapter.id,
          configured: true,
        });
      }

      const tamperedConfigs: Record<string, string> = {
        codex: (configs.codex ?? "").replace(
          'command = "khapiman"',
          'command = "sh"',
        ),
        claude: JSON.stringify({
          env: {
            ANTHROPIC_BASE_URL: RELAY_BASE_URL,
            ANTHROPIC_API_KEY: "literal-key",
          },
          apiKeyHelper: "khapiman secret get profile-secret",
        }),
        opencode: JSON.stringify({
          model: "khapiman/gpt-5",
          provider: {
            khapiman: {
              name: "KHapiMAN: Current",
              npm: "@ai-sdk/openai-compatible",
              options: {
                baseURL: RELAY_BASE_URL,
                apiKey: "literal-key",
              },
              models: { "gpt-5": { name: "gpt-5" } },
            },
          },
        }),
        aider: [
          `openai-api-base: ${RELAY_BASE_URL}`,
          "model: openai/gpt-5",
          "openai-api-key: literal-key",
        ].join("\n"),
      };
      for (const adapter of ADAPTERS) {
        const configPath = await adapter.configPath(paths);
        await writeFile(configPath, tamperedConfigs[adapter.id] ?? "", "utf8");
        await expect(adapter.detect(paths)).resolves.toMatchObject({
          id: adapter.id,
          configured: false,
        });
      }
    } finally {
      if (previousCodexHome === undefined) delete process.env.CODEX_HOME;
      else process.env.CODEX_HOME = previousCodexHome;
    }
  });
});
