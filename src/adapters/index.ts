import type { ToolId } from "../types.js";
import { aiderAdapter } from "./aider.js";
import { claudeAdapter } from "./claude.js";
import { codexAdapter } from "./codex.js";
import { openCodeAdapter } from "./opencode.js";
import type { ToolAdapter } from "./types.js";

export const ADAPTERS: readonly ToolAdapter[] = [
  codexAdapter,
  claudeAdapter,
  openCodeAdapter,
  aiderAdapter,
];

const adapterMap = new Map<ToolId, ToolAdapter>(
  ADAPTERS.map((adapter) => [adapter.id, adapter]),
);

export function getAdapter(tool: ToolId): ToolAdapter {
  const adapter = adapterMap.get(tool);
  if (!adapter) throw new Error(`Unsupported tool: ${tool}`);
  return adapter;
}
