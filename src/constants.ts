import packageMetadata from "../package.json" with { type: "json" };
import type { AppState, RelayProtocol, ToolId } from "./types.js";

export const APP_NAME = "KHapiMAN";
export const COMMAND_NAME = "khapiman";
export const APP_VERSION = packageMetadata.version;
export const SECRET_SERVICE = "KHapiMAN";
export const LEGACY_SECRET_SERVICE = "KHapiman";
export const RELAY_BASE_URL = "https://api.khaix.net";

export const EMPTY_STATE: AppState = {
  schemaVersion: 1,
  profiles: [],
  bindings: {},
};

export const TOOL_LABELS: Record<ToolId, string> = {
  codex: "Codex CLI",
  claude: "Claude Code",
  opencode: "OpenCode",
  aider: "Aider",
};

export const PROTOCOL_LABELS: Record<RelayProtocol, string> = {
  "openai-responses": "OpenAI Responses (Codex)",
  "openai-chat": "OpenAI Chat Completions (OpenCode / Aider)",
  "anthropic-messages": "Anthropic Messages (Claude Code)",
};
