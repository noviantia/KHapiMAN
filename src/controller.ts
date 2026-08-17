import { randomUUID } from "node:crypto";
import { ADAPTERS, getAdapter } from "./adapters/index.js";
import { mergeAdapterEnvironment } from "./adapters/types.js";
import { readOptionalFile } from "./adapters/utils.js";
import { RELAY_BASE_URL } from "./constants.js";
import { fetchModels as fetchModelCatalog } from "./core/models.js";
import { ExpiringPlanStore } from "./core/plans.js";
import { ProfileManager } from "./core/profiles.js";
import { withGlobalLock } from "./core/lock.js";
import { previewFileChanges, TransactionEngine } from "./core/transactions.js";
import {
  installTools as executeInstallers,
  type InstallResult,
} from "./installers.js";
import { resolveRuntimePaths } from "./paths.js";
import { createSecretStore, type SecretStore } from "./secrets/store.js";
import { loadState, saveState } from "./state/store.js";
import type {
  AppState,
  DoctorCheck,
  FileChange,
  RelayProfile,
  RuntimePaths,
  ToolId,
} from "./types.js";
import type {
  ApplyPreview,
  ApplyResult,
  CreateProfileInput,
  KhapimanController,
  UiSnapshot,
} from "./ui/types.js";

interface StoredPlan {
  files: FileChange[];
  tools: ToolId[];
}

function stateText(state: AppState): string {
  return `${JSON.stringify(state, null, 2)}\n`;
}

function withBundledRelay(state: AppState): AppState {
  if (state.profiles.every((profile) => profile.baseUrl === RELAY_BASE_URL)) {
    return state;
  }
  return {
    ...state,
    profiles: state.profiles.map((profile) => ({
      ...profile,
      baseUrl: RELAY_BASE_URL,
    })),
  };
}

export function findProfile(state: AppState, profileId: string): RelayProfile {
  const exactId = state.profiles.find(
    (candidate) => candidate.id === profileId,
  );
  if (exactId) return exactId;

  const named = state.profiles.filter(
    (candidate) => candidate.name === profileId,
  );
  if (named.length === 0) {
    throw new Error(`Relay profile not found: ${profileId}`);
  }
  if (named.length > 1) {
    throw new Error(
      `Relay profile name is ambiguous; use an exact profile ID: ${profileId}`,
    );
  }
  return named[0] as RelayProfile;
}

export class Controller implements KhapimanController {
  private readonly profiles: ProfileManager;
  private readonly transactions: TransactionEngine;
  private readonly plans = new ExpiringPlanStore<StoredPlan>();
  private secretStorePromise?: Promise<SecretStore>;

  constructor(readonly paths: RuntimePaths = resolveRuntimePaths()) {
    this.profiles = new ProfileManager(paths);
    this.transactions = new TransactionEngine(paths);
  }

  private secrets(): Promise<SecretStore> {
    this.secretStorePromise ??= createSecretStore({ paths: this.paths });
    return this.secretStorePromise;
  }

  private async state(): Promise<AppState> {
    return withBundledRelay(await loadState(this.paths));
  }

  async detectTools() {
    return Promise.all(ADAPTERS.map((adapter) => adapter.detect(this.paths)));
  }

  async snapshot(): Promise<UiSnapshot> {
    const [state, statuses, transactions, secrets] = await Promise.all([
      this.state(),
      this.detectTools(),
      this.transactions.list(),
      this.secrets(),
    ]);
    return {
      state,
      statuses,
      transactions,
      secretBackend:
        secrets.status.backend === "keyring"
          ? "OS credential vault"
          : (secrets.status.path ?? "private file"),
      secretBackendSecure: secrets.status.secure,
    };
  }

  async installTools(tools: ToolId[]): Promise<InstallResult[]> {
    return executeInstallers(tools);
  }

  async fetchModels(secret: string): Promise<string[]> {
    return fetchModelCatalog(secret);
  }

  async createProfile(input: CreateProfileInput): Promise<RelayProfile> {
    const secrets = await this.secrets();
    const secretId = `profile-${randomUUID()}`;
    await secrets.set(secretId, input.secret);
    try {
      return await this.profiles.create({
        name: input.name,
        baseUrl: RELAY_BASE_URL,
        protocols: input.protocols,
        ...(input.model === undefined ? {} : { model: input.model }),
        secretId,
      });
    } catch (error) {
      await secrets.delete(secretId).catch(() => false);
      throw error;
    }
  }

  async deleteProfile(profileId: string): Promise<void> {
    await withGlobalLock(this.paths, async () => {
      const state = await this.state();
      const profile = findProfile(state, profileId);
      const activeTools = Object.values(state.bindings).filter(
        (binding) => binding?.profileId === profile.id,
      );
      if (activeTools.length > 0) {
        throw new Error(
          "The profile is active. Roll back or switch its tools before deleting it.",
        );
      }

      const secrets = await this.secrets();
      const existingSecret = await secrets.get(profile.secretId);
      const credentialDeleted = await secrets.delete(profile.secretId);
      if (existingSecret !== undefined && !credentialDeleted) {
        throw new Error(
          "The profile credential could not be deleted; the profile was kept.",
        );
      }

      state.profiles = state.profiles.filter(
        (candidate) => candidate.id !== profile.id,
      );
      try {
        await saveState(state, this.paths);
      } catch (error) {
        if (existingSecret !== undefined) {
          try {
            await secrets.set(profile.secretId, existingSecret);
          } catch (restoreError) {
            throw new AggregateError(
              [error, restoreError],
              "Profile state could not be saved and its credential could not be restored.",
              { cause: restoreError },
            );
          }
        }
        throw error;
      }
    });
  }

  async previewApply(
    profileId: string,
    tools: ToolId[],
    model?: string,
  ): Promise<ApplyPreview> {
    if (tools.length === 0) throw new Error("Select at least one target tool.");
    const uniqueTools = [...new Set(tools)];
    const state = await this.state();
    const profile = findProfile(state, profileId);
    const selectedModel = model ?? profile.model;
    const plannedGroups = await Promise.all(
      uniqueTools.map((tool) =>
        getAdapter(tool).plan(
          this.paths,
          profile,
          selectedModel === undefined ? {} : { model: selectedModel },
        ),
      ),
    );
    const files = plannedGroups.flat();

    const nextState = structuredClone(state);
    const appliedAt = new Date().toISOString();
    for (const tool of uniqueTools) {
      nextState.bindings[tool] = {
        tool,
        profileId: profile.id,
        ...(selectedModel && tool !== "claude" ? { model: selectedModel } : {}),
        appliedAt,
      };
    }
    const stateBefore = await readOptionalFile(this.paths.stateFile, "");
    files.push({
      path: this.paths.stateFile,
      before: stateBefore || null,
      after: stateText(nextState),
      mode: 0o600,
      description: "Record active tool bindings in KHapiMAN state.",
    });

    const secrets = await this.secrets();
    const secret = await secrets.get(profile.secretId);
    const previews = previewFileChanges(files, {
      secrets: secret ? [secret] : [],
    });
    const planId = randomUUID();
    this.plans.set(planId, { files, tools: uniqueTools });
    return {
      planId,
      profileId: profile.id,
      tools: uniqueTools,
      ...(selectedModel ? { model: selectedModel } : {}),
      diff: previews
        .filter((item) => item.changed)
        .map((item) => item.diff)
        .join("\n"),
      fileCount: previews.filter((item) => item.changed).length,
      notes: uniqueTools
        .filter(
          (tool) =>
            tool === "claude" || tool === "opencode" || tool === "aider",
        )
        .map(
          (tool) =>
            `Launch ${getAdapter(tool).label} with \`khapiman run ${tool}\` so its key stays out of config files.`,
        ),
    };
  }

  async apply(preview: ApplyPreview): Promise<ApplyResult> {
    const plan = this.plans.take(preview.planId);
    if (!plan)
      throw new Error(
        "This preview has expired. Build it again before applying.",
      );
    const manifest = await this.transactions.apply(plan.files);
    return { transactionId: manifest.id, tools: plan.tools };
  }

  cancelApply(planId: string): void {
    this.plans.delete(planId);
  }

  async doctor(): Promise<DoctorCheck[]> {
    const { state, statuses, secretBackend, secretBackendSecure } =
      await this.snapshot();
    const checks: DoctorCheck[] = [
      {
        id: "runtime",
        label: "Node.js runtime",
        status:
          Number(process.versions.node.split(".")[0]) >= 22 ? "pass" : "fail",
        detail: `Node ${process.versions.node} on ${process.platform}/${process.arch}`,
      },
      {
        id: "secrets",
        label: "Secret storage",
        status: secretBackendSecure ? "pass" : "warn",
        detail: secretBackend,
      },
    ];

    for (const status of statuses) {
      const hasBinding = Boolean(state.bindings[status.id]);
      const needsReapply = hasBinding && !status.configured;
      checks.push({
        id: `tool-${status.id}`,
        label: status.label,
        status: status.installed && status.configured ? "pass" : "warn",
        detail: !status.installed
          ? `Executable was not found on PATH${needsReapply ? "; saved binding must be re-applied to the bundled endpoint" : ""}`
          : needsReapply
            ? `${status.version ?? "version unknown"}; saved binding does not match the bundled endpoint; re-apply the profile`
            : `${status.version ?? "version unknown"}; config ${status.configured ? "managed" : "not managed"}`,
      });
    }

    const secrets = await this.secrets();
    for (const profile of state.profiles) {
      const present = Boolean(await secrets.get(profile.secretId));
      checks.push({
        id: `profile-${profile.id}`,
        label: profile.name,
        status: present ? "pass" : "fail",
        detail: present
          ? `${profile.baseUrl}; credential available`
          : "Credential is missing",
      });
    }
    return checks;
  }

  async testConnection(profileId: string): Promise<DoctorCheck[]> {
    const state = await this.state();
    const profile = findProfile(state, profileId);
    const started = Date.now();
    try {
      const response = await fetch(profile.baseUrl, {
        method: "HEAD",
        redirect: "manual",
        signal: AbortSignal.timeout(8_000),
      });
      return [
        {
          id: `connection-${profile.id}`,
          label: profile.name,
          status: response.status >= 500 ? "warn" : "pass",
          detail: `HTTP ${response.status} in ${Date.now() - started} ms; no credential was sent`,
        },
      ];
    } catch (error) {
      return [
        {
          id: `connection-${profile.id}`,
          label: profile.name,
          status: "fail",
          detail: error instanceof Error ? error.message : String(error),
        },
      ];
    }
  }

  async rollback(transactionId: string): Promise<void> {
    await this.transactions.rollback(transactionId);
  }

  async getSecret(secretId: string): Promise<string | undefined> {
    return (await this.secrets()).get(secretId);
  }

  async runEnvironment(tool: ToolId): Promise<{
    command: string;
    args: string[];
    env: NodeJS.ProcessEnv;
  }> {
    if (tool === "codex") {
      throw new Error(
        "Codex uses the configured credential helper directly; launch `codex` without `khapiman run`.",
      );
    }
    const state = await this.state();
    const binding = state.bindings[tool];
    if (!binding)
      throw new Error(
        `${getAdapter(tool).label} has no active KHapiMAN binding.`,
      );
    const profile = findProfile(state, binding.profileId);
    const adapter = getAdapter(tool);
    const status = await adapter.detect(this.paths);
    if (!status.configured) {
      throw new Error(
        `${adapter.label} does not match the bundled KHaiXAPI endpoint. Re-apply its profile before launching it.`,
      );
    }
    const secret = await (await this.secrets()).get(profile.secretId);
    if (!secret)
      throw new Error(`Credential is missing for profile ${profile.name}.`);
    return {
      command: adapter.command,
      args: adapter.launchArgs?.(profile, binding.model) ?? [],
      env: mergeAdapterEnvironment(
        process.env,
        adapter.environment(profile, secret, binding.model),
        adapter.unsetEnvironment,
      ),
    };
  }

  async rawState(): Promise<AppState> {
    return this.state();
  }

  async latestTransactions() {
    return this.transactions.list();
  }

  async exportRedacted(): Promise<string> {
    return stateText(await this.state());
  }
}
