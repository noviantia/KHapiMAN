import path from "node:path";
import { parseTOML, type AST } from "toml-eslint-parser";
import { RELAY_BASE_URL, TOOL_LABELS } from "../constants.js";
import type { FileChange, RelayProfile, RuntimePaths } from "../types.js";
import type { AdapterPlanOptions, ToolAdapter } from "./types.js";
import {
  assertProtocol,
  basicDetect,
  readOptionalFile,
  requireModel,
} from "./utils.js";

const PROVIDER_START =
  "# >>> KHapiMAN provider (managed; use khapiman rollback to restore)";
const PROVIDER_END = "# <<< KHapiMAN provider";
const LEGACY_PROVIDER_START =
  "# >>> KHapiman provider (managed; use khapiman rollback to restore)";
const LEGACY_PROVIDER_END = "# <<< KHapiman provider";

function normalizeManagedMarkers(source: string): string {
  return source
    .replaceAll(LEGACY_PROVIDER_START, PROVIDER_START)
    .replaceAll(LEGACY_PROVIDER_END, PROVIDER_END);
}

function tomlString(value: string): string {
  return JSON.stringify(value);
}

function keyName(key: AST.TOMLKey): string {
  return key.keys.map((part) => ("name" in part ? part.name : "")).join(".");
}

function removeManagedProvider(source: string): string {
  source = normalizeManagedMarkers(source);
  const start = source.indexOf(PROVIDER_START);
  if (start < 0) return source;
  const endMarker = source.indexOf(PROVIDER_END, start);
  if (endMarker < 0) {
    throw new Error(
      "The KHapiMAN block in Codex config.toml is incomplete. Roll back or repair it first.",
    );
  }
  const endOfMarker = endMarker + PROVIDER_END.length;
  const end =
    source[endOfMarker] === "\r" && source[endOfMarker + 1] === "\n"
      ? endOfMarker + 2
      : source[endOfMarker] === "\n"
        ? endOfMarker + 1
        : endOfMarker;
  return `${source.slice(0, start).trimEnd()}${source.slice(end)}`;
}

function isCurrentManagedConfig(source: string): boolean {
  source = normalizeManagedMarkers(source);
  const start = source.indexOf(PROVIDER_START);
  const end = source.indexOf(PROVIDER_END, start);
  if (start < 0 || end < 0) return false;
  try {
    const ast = parseTOML(source.slice(start, end));
    const tables = ast.body[0]?.body ?? [];
    const provider = tables.find(
      (node): node is AST.TOMLTable =>
        node.type === "TOMLTable" &&
        keyName(node.key) === "model_providers.khapiman",
    );
    const auth = tables.find(
      (node): node is AST.TOMLTable =>
        node.type === "TOMLTable" &&
        keyName(node.key) === "model_providers.khapiman.auth",
    );
    if (!provider || !auth) return false;
    const values = new Map(
      provider.body.map((node) => [keyName(node.key), node.value]),
    );
    const authValues = new Map(
      auth.body.map((node) => [keyName(node.key), node.value]),
    );
    const args = authValues.get("args");
    const secretId =
      args?.type === "TOMLArray" && args.elements.length === 3
        ? args.elements[2]
        : undefined;
    const name = values.get("name");
    const baseUrl = values.get("base_url");
    const wireApi = values.get("wire_api");
    const command = authValues.get("command");
    return (
      name?.type === "TOMLValue" &&
      name.kind === "string" &&
      /^KHapi(?:MAN|man): .+$/u.test(name.value) &&
      baseUrl?.type === "TOMLValue" &&
      baseUrl.kind === "string" &&
      baseUrl.value === RELAY_BASE_URL &&
      wireApi?.type === "TOMLValue" &&
      wireApi.kind === "string" &&
      wireApi.value === "responses" &&
      command?.type === "TOMLValue" &&
      command.kind === "string" &&
      command.value === "khapiman" &&
      args?.type === "TOMLArray" &&
      args.elements[0]?.type === "TOMLValue" &&
      args.elements[0].kind === "string" &&
      args.elements[0].value === "secret" &&
      args.elements[1]?.type === "TOMLValue" &&
      args.elements[1].kind === "string" &&
      args.elements[1].value === "get" &&
      secretId?.type === "TOMLValue" &&
      secretId.kind === "string" &&
      /^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$/u.test(secretId.value)
    );
  } catch {
    return false;
  }
}

function updateRootValues(
  source: string,
  values: Record<string, string>,
): string {
  const ast = parseTOML(source || "");
  const topLevel = ast.body[0];
  const replacements: Array<{ start: number; end: number; value: string }> = [];
  const found = new Set<string>();

  for (const node of topLevel?.body ?? []) {
    if (node.type !== "TOMLKeyValue") continue;
    const name = keyName(node.key);
    if (!(name in values)) continue;
    found.add(name);
    replacements.push({
      start: node.value.range[0],
      end: node.value.range[1],
      value: tomlString(values[name] ?? ""),
    });
  }

  let result = source;
  for (const replacement of [...replacements].sort(
    (a, b) => b.start - a.start,
  )) {
    result = `${result.slice(0, replacement.start)}${replacement.value}${result.slice(replacement.end)}`;
  }

  const missing = Object.entries(values).filter(([name]) => !found.has(name));
  if (missing.length > 0) {
    const prefix = [
      "# KHapiMAN active relay. Run `khapiman rollback` to restore the previous values.",
      ...missing.map(([name, value]) => `${name} = ${tomlString(value)}`),
      "",
    ].join("\n");
    result = `${prefix}${result}`;
  }
  return result;
}

function hasUnmanagedProvider(source: string): boolean {
  const ast = parseTOML(source || "");
  const topLevel = ast.body[0];
  return (topLevel?.body ?? []).some(
    (node) =>
      node.type === "TOMLTable" &&
      keyName(node.key) === "model_providers.khapiman",
  );
}

export function renderCodexConfig(
  source: string,
  profile: RelayProfile,
  model: string,
): string {
  const newline = source.includes("\r\n") ? "\r\n" : "\n";
  const withoutManaged = removeManagedProvider(source);
  if (hasUnmanagedProvider(withoutManaged)) {
    throw new Error(
      "Codex already has an unmanaged [model_providers.khapiman] table. Rename it before applying.",
    );
  }
  let result = updateRootValues(withoutManaged, {
    model,
    model_provider: "khapiman",
  }).trimEnd();
  const providerBlock = [
    PROVIDER_START,
    "[model_providers.khapiman]",
    `name = ${tomlString(`KHapiMAN: ${profile.name}`)}`,
    `base_url = ${tomlString(profile.baseUrl)}`,
    'wire_api = "responses"',
    "",
    "[model_providers.khapiman.auth]",
    'command = "khapiman"',
    `args = ["secret", "get", ${tomlString(profile.secretId)}]`,
    PROVIDER_END,
    "",
  ].join(newline);
  result = `${result}${result ? `${newline}${newline}` : ""}${providerBlock}`;
  parseTOML(result);
  return result;
}

export const codexAdapter: ToolAdapter = {
  id: "codex",
  label: TOOL_LABELS.codex,
  command: "codex",
  protocols: ["openai-responses"],
  configPath(paths: RuntimePaths): string {
    return path.join(
      process.env.CODEX_HOME ?? path.join(paths.home, ".codex"),
      "config.toml",
    );
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
    const model = requireModel(options.model, this.label);
    const configPath = this.configPath(paths) as string;
    const before = await readOptionalFile(configPath, "");
    const after = renderCodexConfig(before, profile, model);
    return [
      {
        path: configPath,
        before: before || null,
        after,
        mode: 0o600,
        description:
          "Configure the Codex Responses provider and credential helper.",
      },
    ];
  },
  environment() {
    return {};
  },
};
