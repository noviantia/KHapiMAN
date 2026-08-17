import type {
  AppState,
  DoctorCheck,
  RelayProfile,
  RelayProtocol,
  ToolId,
  ToolStatus,
  TransactionManifest,
} from "../types.js";
import type { InstallResult } from "../installers.js";

export interface CreateProfileInput {
  name: string;
  protocols: RelayProtocol[];
  secret: string;
  model?: string;
}

export interface ApplyPreview {
  planId: string;
  profileId: string;
  tools: ToolId[];
  model?: string;
  diff: string;
  fileCount: number;
  notes: string[];
}

export interface ApplyResult {
  transactionId: string;
  tools: ToolId[];
}

export interface UiSnapshot {
  state: AppState;
  statuses: ToolStatus[];
  transactions: TransactionManifest[];
  secretBackend: string;
  secretBackendSecure: boolean;
}

export interface KhapimanController {
  snapshot(): Promise<UiSnapshot>;
  detectTools(): Promise<ToolStatus[]>;
  installTools(tools: ToolId[]): Promise<InstallResult[]>;
  fetchModels(secret: string): Promise<string[]>;
  createProfile(input: CreateProfileInput): Promise<RelayProfile>;
  deleteProfile(profileId: string): Promise<void>;
  previewApply(
    profileId: string,
    tools: ToolId[],
    model?: string,
  ): Promise<ApplyPreview>;
  apply(preview: ApplyPreview): Promise<ApplyResult>;
  cancelApply?(planId: string): void;
  doctor(): Promise<DoctorCheck[]>;
  testConnection(profileId: string): Promise<DoctorCheck[]>;
  rollback(transactionId: string): Promise<void>;
}
