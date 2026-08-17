import path from "node:path";
import { parseDocument } from "yaml";
import { TOOL_LABELS } from "../constants.js";
import type { FileChange, RelayProfile, RuntimePaths } from "../types.js";
import type { AdapterPlanOptions, ToolAdapter } from "./types.js";
import {
  assertProtocol,
  basicDetect,
  readOptionalFile,
  requireModel,
} from "./utils.js";

const MANAGED_MARKER =
  /^# >>> KHapi(?:MAN|man) Aider profile: ([a-zA-Z0-9][a-zA-Z0-9._:-]{0,127})$/mu;

function withoutManagedMarker(source: string): string {
  return source.replace(MANAGED_MARKER, "").replace(/^\r?\n/u, "");
}

function isCurrentManagedConfig(source: string): boolean {
  try {
    if (!MANAGED_MARKER.test(source)) return false;
    const document = parseDocument(withoutManagedMarker(source) || "{}\n", {
      keepSourceTokens: true,
      prettyErrors: true,
    });
    return (
      document.errors.length === 0 &&
      !document.has("openai-api-base") &&
      !document.has("openai-api-key")
    );
  } catch {
    return false;
  }
}

export function renderAiderConfig(
  source: string,
  profile: RelayProfile,
): string {
  const document = parseDocument(withoutManagedMarker(source) || "{}\n", {
    keepSourceTokens: true,
    prettyErrors: true,
  });
  if (document.errors.length > 0) {
    throw new Error(
      "Aider .aider.conf.yml contains invalid YAML and was not changed.",
    );
  }
  document.delete("openai-api-base");
  document.delete("model");
  document.delete("openai-api-key");
  const result = document.toString({ lineWidth: 0 });
  const marked = `# >>> KHapiMAN Aider profile: ${profile.id}\n${result}`;
  return marked.endsWith("\n") ? marked : `${marked}\n`;
}

export const aiderAdapter: ToolAdapter = {
  id: "aider",
  label: TOOL_LABELS.aider,
  command: "aider",
  protocols: ["openai-chat"],
  configPath(paths: RuntimePaths): string {
    return path.join(paths.home, ".aider.conf.yml");
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
  async plan(
    paths,
    profile,
    options: AdapterPlanOptions,
  ): Promise<FileChange[]> {
    assertProtocol(profile, this.protocols, this.label);
    requireModel(options.model, this.label);
    const configPath = this.configPath(paths) as string;
    const before = await readOptionalFile(configPath, "");
    return [
      {
        path: configPath,
        before: before || null,
        after: renderAiderConfig(before, profile),
        mode: 0o600,
        description:
          "Remove persistent Aider relay settings and record the managed Profile marker.",
      },
    ];
  },
  environment(profile, secret, model) {
    return {
      AIDER_OPENAI_API_BASE: profile.baseUrl,
      AIDER_OPENAI_API_KEY: secret,
      OPENAI_API_BASE: profile.baseUrl,
      OPENAI_API_KEY: secret,
      ...(model
        ? {
            AIDER_MODEL: model.startsWith("openai/")
              ? model
              : `openai/${model}`,
          }
        : {}),
    };
  },
  launchArgs(profile, model) {
    const selectedModel = requireModel(model, this.label);
    return [
      "--openai-api-base",
      profile.baseUrl,
      "--model",
      selectedModel.startsWith("openai/")
        ? selectedModel
        : `openai/${selectedModel}`,
    ];
  },
};
