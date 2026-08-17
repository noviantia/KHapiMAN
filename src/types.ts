export const TOOL_IDS = ["codex", "claude", "opencode", "aider"] as const;

export type ToolId = (typeof TOOL_IDS)[number];

export const PROTOCOLS = [
  "openai-responses",
  "openai-chat",
  "anthropic-messages",
] as const;

export type RelayProtocol = (typeof PROTOCOLS)[number];

export interface RelayProfile {
  id: string;
  name: string;
  baseUrl: string;
  protocols: RelayProtocol[];
  model?: string;
  secretId: string;
  createdAt: string;
  updatedAt: string;
}

export interface ToolBinding {
  tool: ToolId;
  profileId: string;
  model?: string;
  appliedAt: string;
}

export interface AppState {
  schemaVersion: 1;
  profiles: RelayProfile[];
  bindings: Partial<Record<ToolId, ToolBinding>>;
}

export interface RuntimePaths {
  home: string;
  dataDir: string;
  stateFile: string;
  backupDir: string;
  lockFile: string;
}

export interface ToolStatus {
  id: ToolId;
  label: string;
  installed: boolean;
  executable?: string;
  version?: string;
  configPath: string;
  configured: boolean;
  profileName?: string;
  detail?: string;
}

export interface FileChange {
  path: string;
  before: string | null;
  after: string;
  mode?: number;
  description: string;
}

export interface PlannedToolChange {
  tool: ToolId;
  profile: RelayProfile;
  model?: string;
  files: FileChange[];
  notes: string[];
}

export interface TransactionFile {
  path: string;
  existed: boolean;
  beforeHash: string | null;
  afterHash: string;
  backupPath: string | null;
}

export type TransactionStatus =
  "prepared" | "applied" | "failed" | "rolling-back" | "rolled-back";

export interface TransactionManifest {
  id: string;
  createdAt: string;
  files: TransactionFile[];
  status?: TransactionStatus;
}

export interface DoctorCheck {
  id: string;
  label: string;
  status: "pass" | "warn" | "fail";
  detail: string;
}
