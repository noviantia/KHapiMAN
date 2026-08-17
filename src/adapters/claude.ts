import path from "node:path";
import {
  applyEdits,
  modify,
  parse,
  type FormattingOptions,
  type ParseError,
} from "jsonc-parser";
import { TOOL_LABELS } from "../constants.js";
import type { FileChange, RelayProfile, RuntimePaths } from "../types.js";
import type { ToolAdapter } from "./types.js";
import { assertProtocol, basicDetect, readOptionalFile } from "./utils.js";

const formattingOptions: FormattingOptions = {
  insertSpaces: true,
  tabSize: 2,
  eol: "\n",
};

function setJsonc(
  source: string,
  targetPath: (string | number)[],
  value: unknown,
): string {
  return applyEdits(
    source,
    modify(source, targetPath, value, { formattingOptions }),
  );
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function isCurrentManagedConfig(source: string): boolean {
  try {
    const errors: ParseError[] = [];
    const root = asRecord(
      parse(source, errors, {
        allowTrailingComma: true,
        disallowComments: false,
      }),
    );
    const env = asRecord(root?.env);
    const marker = env?.KHAPIMAN_CLAUDE_PROFILE;
    return (
      errors.length === 0 &&
      env !== undefined &&
      typeof marker === "string" &&
      /^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$/u.test(marker) &&
      !("ANTHROPIC_BASE_URL" in env) &&
      !("ANTHROPIC_AUTH_TOKEN" in env) &&
      !("ANTHROPIC_API_KEY" in env) &&
      !("apiKeyHelper" in (root ?? {}))
    );
  } catch {
    return false;
  }
}

export function renderClaudeConfig(
  source: string,
  profile: RelayProfile,
): string {
  let result = source.trim() ? source : "{}\n";
  const errors: ParseError[] = [];
  parse(result, errors, { allowTrailingComma: true, disallowComments: false });
  if (errors.length > 0) {
    throw new Error(
      "Claude settings.json contains invalid JSON/JSONC and was not changed.",
    );
  }
  result = setJsonc(result, ["env", "ANTHROPIC_BASE_URL"], undefined);
  result = setJsonc(result, ["env", "ANTHROPIC_AUTH_TOKEN"], undefined);
  result = setJsonc(result, ["env", "ANTHROPIC_API_KEY"], undefined);
  result = setJsonc(result, ["env", "KHAPIMAN_CLAUDE_PROFILE"], profile.id);
  result = setJsonc(result, ["apiKeyHelper"], undefined);
  return result.endsWith("\n") ? result : `${result}\n`;
}

export const claudeAdapter: ToolAdapter = {
  id: "claude",
  label: TOOL_LABELS.claude,
  command: "claude",
  protocols: ["anthropic-messages"],
  configPath(paths: RuntimePaths): string {
    return path.join(paths.home, ".claude", "settings.json");
  },
  async detect(paths) {
    const configPath = this.configPath(paths) as string;
    return basicDetect({
      id: this.id,
      command: this.command,
      configPath,
      isConfigured: isCurrentManagedConfig,
      paths,
    });
  },
  async plan(paths, profile): Promise<FileChange[]> {
    assertProtocol(profile, this.protocols, this.label);
    const configPath = this.configPath(paths) as string;
    const before = await readOptionalFile(configPath, "");
    return [
      {
        path: configPath,
        before: before || null,
        after: renderClaudeConfig(before, profile),
        mode: 0o600,
        description:
          "Remove persistent Claude credentials and record the managed Profile marker.",
      },
    ];
  },
  environment() {
    return {};
  },
  unsetEnvironment: [
    "ANTHROPIC_API_KEY",
    "ANTHROPIC_AUTH_TOKEN",
    "ANTHROPIC_BASE_URL",
    "ANTHROPIC_CUSTOM_HEADERS",
    "CLAUDE_CODE_OAUTH_TOKEN",
    "CLAUDE_CODE_OAUTH_REFRESH_TOKEN",
    "CLAUDE_CODE_PROVIDER_MANAGED_BY_HOST",
    "CLAUDE_CODE_USE_ANTHROPIC_AWS",
    "CLAUDE_CODE_USE_BEDROCK",
    "CLAUDE_CODE_USE_FOUNDRY",
    "CLAUDE_CODE_USE_MANTLE",
    "CLAUDE_CODE_USE_VERTEX",
  ],
  launchArgs(profile) {
    return [
      "--settings",
      JSON.stringify({
        env: {
          ANTHROPIC_BASE_URL: profile.baseUrl,
          CLAUDE_CODE_USE_ANTHROPIC_AWS: "",
          CLAUDE_CODE_USE_BEDROCK: "",
          CLAUDE_CODE_USE_FOUNDRY: "",
          CLAUDE_CODE_USE_MANTLE: "",
          CLAUDE_CODE_USE_VERTEX: "",
        },
        apiKeyHelper: `khapiman secret get ${profile.secretId}`,
      }),
    ];
  },
};
