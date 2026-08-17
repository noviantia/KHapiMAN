import path from "node:path";
import {
  applyEdits,
  modify,
  parse,
  type FormattingOptions,
  type ParseError,
} from "jsonc-parser";
import { RELAY_BASE_URL, TOOL_LABELS } from "../constants.js";
import type { FileChange, RelayProfile, RuntimePaths } from "../types.js";
import type { AdapterPlanOptions, ToolAdapter } from "./types.js";
import {
  assertProtocol,
  basicDetect,
  fileExists,
  readOptionalFile,
  requireModel,
  secretEnvironmentName,
} from "./utils.js";

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

function isManagedProvider(value: unknown): boolean {
  const name = asRecord(value)?.name;
  return typeof name === "string" && /^KHapi(?:MAN|man):/u.test(name);
}

function isSecretEnvironmentReference(value: unknown): boolean {
  return (
    typeof value === "string" &&
    /^\{env:KHAPIMAN_API_KEY_[A-Z0-9_]+\}$/u.test(value)
  );
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
    const provider = asRecord(asRecord(root?.provider)?.khapiman);
    const options = asRecord(provider?.options);
    const models = asRecord(provider?.models);
    const model = root?.model;
    const modelId =
      typeof model === "string" && model.startsWith("khapiman/")
        ? model.slice("khapiman/".length)
        : undefined;
    const modelConfig =
      modelId === undefined ? undefined : asRecord(models?.[modelId]);
    return (
      errors.length === 0 &&
      isManagedProvider(provider) &&
      provider?.npm === "@ai-sdk/openai-compatible" &&
      options?.baseURL === RELAY_BASE_URL &&
      isSecretEnvironmentReference(options?.apiKey) &&
      modelId !== undefined &&
      modelConfig?.name === modelId
    );
  } catch {
    return false;
  }
}

export function renderOpenCodeConfig(
  source: string,
  profile: RelayProfile,
  model: string,
): string {
  let result = source.trim() ? source : "{}\n";
  const errors: ParseError[] = [];
  const parsed = parse(result, errors, {
    allowTrailingComma: true,
    disallowComments: false,
  }) as unknown;
  if (errors.length > 0) {
    throw new Error(
      "OpenCode config contains invalid JSON/JSONC and was not changed.",
    );
  }
  const existingProvider = asRecord(asRecord(parsed)?.provider)?.khapiman;
  if (existingProvider !== undefined && !isManagedProvider(existingProvider)) {
    throw new Error(
      'OpenCode provider "khapiman" already exists and is not managed by KHapiMAN.',
    );
  }
  const envName = secretEnvironmentName(profile.id);
  const provider = {
    name: `KHapiMAN: ${profile.name}`,
    npm: "@ai-sdk/openai-compatible",
    options: {
      baseURL: profile.baseUrl,
      apiKey: `{env:${envName}}`,
    },
    models: { [model]: { name: model } },
  };
  result = setJsonc(result, ["$schema"], "https://opencode.ai/config.json");
  result = setJsonc(result, ["provider", "khapiman"], provider);
  result = setJsonc(result, ["model"], `khapiman/${model}`);
  return result.endsWith("\n") ? result : `${result}\n`;
}

export function renderOpenCodeRuntimeConfig(
  profile: RelayProfile,
  model: string,
): string {
  const envName = secretEnvironmentName(profile.id);
  return JSON.stringify({
    model: `khapiman/${model}`,
    provider: {
      khapiman: {
        name: `KHapiMAN: ${profile.name}`,
        npm: "@ai-sdk/openai-compatible",
        options: {
          baseURL: profile.baseUrl,
          apiKey: `{env:${envName}}`,
        },
        models: { [model]: { name: model } },
      },
    },
  });
}

export const openCodeAdapter: ToolAdapter = {
  id: "opencode",
  label: TOOL_LABELS.opencode,
  command: "opencode",
  protocols: ["openai-chat"],
  async configPath(paths: RuntimePaths): Promise<string> {
    const directory = path.join(paths.home, ".config", "opencode");
    const jsoncPath = path.join(directory, "opencode.jsonc");
    if (await fileExists(jsoncPath)) return jsoncPath;
    const jsonPath = path.join(directory, "opencode.json");
    return (await fileExists(jsonPath)) ? jsonPath : jsoncPath;
  },
  async detect(paths) {
    const configPath = await this.configPath(paths);
    return basicDetect({
      id: this.id,
      command: this.command,
      configPath,
      isConfigured: isCurrentManagedConfig,
      paths,
    });
  },
  async plan(
    paths,
    profile,
    options: AdapterPlanOptions,
  ): Promise<FileChange[]> {
    assertProtocol(profile, this.protocols, this.label);
    const model = requireModel(options.model, this.label);
    const configPath = await this.configPath(paths);
    const before = await readOptionalFile(configPath, "");
    return [
      {
        path: configPath,
        before: before || null,
        after: renderOpenCodeConfig(before, profile, model),
        mode: 0o600,
        description: "Configure an OpenCode OpenAI-compatible provider.",
      },
    ];
  },
  environment(profile, secret, model) {
    const selectedModel = requireModel(model, this.label);
    return {
      [secretEnvironmentName(profile.id)]: secret,
      OPENCODE_CONFIG_CONTENT: renderOpenCodeRuntimeConfig(
        profile,
        selectedModel,
      ),
    };
  },
};
