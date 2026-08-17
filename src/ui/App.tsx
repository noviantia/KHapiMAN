import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  Alert,
  ConfirmInput,
  PasswordInput,
  Select,
  Spinner,
  StatusMessage,
  TextInput,
} from "@inkjs/ui";
import { Box, Text, useApp, useInput } from "ink";
import { TOOL_LABELS } from "../constants.js";
import { createInstallPlan, type InstallResult } from "../installers.js";
import {
  isTerminalIdentifier,
  terminalLine,
  terminalMultiline,
} from "../terminal.js";
import {
  PROTOCOLS,
  type DoctorCheck,
  type RelayProfile,
  type RelayProtocol,
  type ToolId,
} from "../types.js";
import { ControlledMultiSelect } from "./ControlledMultiSelect.js";
import { Header } from "./Header.js";
import { detectUiLocale, uiMessage, type UiLocale } from "./i18n.js";
import { Workspace, type WorkspaceAction } from "./Workspace.js";
import type {
  ApplyPreview,
  CreateProfileInput,
  KhapimanController,
  UiSnapshot,
} from "./types.js";

type Screen =
  | "language"
  | "home"
  | "install-tools"
  | "install-preview"
  | "install-result"
  | "api-name"
  | "api-secret"
  | "api-model"
  | "profile-actions"
  | "test-profile"
  | "remove-profile"
  | "remove-confirm"
  | "client-actions"
  | "assign-tool"
  | "assign-profile"
  | "assign-model"
  | "apply-preview"
  | "rollback-select"
  | "rollback-confirm"
  | "doctor-result"
  | "settings"
  | "busy"
  | "result";

const BACK_TARGETS: Partial<Record<Screen, Screen>> = {
  language: "home",
  "install-tools": "client-actions",
  "install-preview": "install-tools",
  "install-result": "home",
  "api-name": "home",
  "api-secret": "api-name",
  "api-model": "api-secret",
  "profile-actions": "home",
  "test-profile": "profile-actions",
  "remove-profile": "profile-actions",
  "remove-confirm": "remove-profile",
  "client-actions": "home",
  "assign-tool": "client-actions",
  "assign-profile": "assign-tool",
  "assign-model": "assign-profile",
  "apply-preview": "assign-profile",
  "rollback-select": "home",
  "rollback-confirm": "rollback-select",
  "doctor-result": "home",
  settings: "home",
  result: "home",
};

const ACCEPTED_PROTOCOL: Record<ToolId, RelayProtocol> = {
  codex: "openai-responses",
  claude: "anthropic-messages",
  opencode: "openai-chat",
  aider: "openai-chat",
};

export interface AppProps {
  controller: KhapimanController;
  ascii?: boolean;
  initialLocale?: UiLocale;
  terminalWidth?: number;
}

const PROFILE_NAME_LIMIT = 100;
const MODEL_ID_LIMIT = 256;
const ERROR_MESSAGE_LIMIT = 800;

function caughtMessage(caught: unknown): string {
  return terminalLine(
    caught instanceof Error ? caught.message : String(caught),
    ERROR_MESSAGE_LIMIT,
  );
}

export function App({
  controller,
  ascii = false,
  initialLocale,
  terminalWidth,
}: AppProps) {
  const { exit } = useApp();
  const outputWidth = Math.max(
    1,
    terminalWidth ?? process.stdout.columns ?? 80,
  );
  const [locale, setLocale] = useState<UiLocale>(
    () => initialLocale ?? detectUiLocale(),
  );
  const [screen, setScreen] = useState<Screen>("language");
  const [snapshot, setSnapshot] = useState<UiSnapshot>();
  const [busyLabel, setBusyLabel] = useState(() =>
    uiMessage(locale, "busy.scanning"),
  );
  const [error, setError] = useState<string>();
  const [result, setResult] = useState<string>();
  const [draft, setDraft] = useState<Partial<CreateProfileInput>>({});
  const [models, setModels] = useState<string[]>([]);
  const [selectedProfileId, setSelectedProfileId] = useState<string>();
  const [selectedTools, setSelectedTools] = useState<ToolId[]>([]);
  const [installResults, setInstallResults] = useState<InstallResult[]>([]);
  const [preview, setPreview] = useState<ApplyPreview>();
  const [doctorChecks, setDoctorChecks] = useState<DoctorCheck[]>([]);
  const [selectedTransactionId, setSelectedTransactionId] = useState<string>();
  const pendingSecretRef = useRef<string | undefined>(undefined);
  const flowEpochRef = useRef(0);

  const beginFlow = useCallback(() => {
    flowEpochRef.current += 1;
    return flowEpochRef.current;
  }, []);

  const isCurrentFlow = useCallback(
    (epoch: number) => flowEpochRef.current === epoch,
    [],
  );

  const languageOptions = useMemo(() => {
    const english = {
      label: uiMessage(locale, "language.english"),
      value: "en",
    };
    const chinese = {
      label: uiMessage(locale, "language.chinese"),
      value: "zh-CN",
    };
    return locale === "zh-CN" ? [chinese, english] : [english, chinese];
  }, [locale]);

  const refresh = useCallback(async () => {
    setSnapshot(await controller.snapshot());
  }, [controller]);

  const loadInitialSnapshot = useCallback(async () => {
    const epoch = beginFlow();
    setError(undefined);
    try {
      const nextSnapshot = await controller.snapshot();
      if (!isCurrentFlow(epoch)) return;
      setSnapshot(nextSnapshot);
    } catch (caught) {
      if (!isCurrentFlow(epoch)) return;
      setError(caughtMessage(caught));
    }
  }, [beginFlow, controller, isCurrentFlow]);

  useEffect(() => {
    void loadInitialSnapshot();
  }, [loadInitialSnapshot]);

  const returnHome = useCallback(async () => {
    beginFlow();
    pendingSecretRef.current = undefined;
    setError(undefined);
    setResult(undefined);
    setDraft({});
    setModels([]);
    setPreview(undefined);
    setDoctorChecks([]);
    setSelectedTransactionId(undefined);
    setSelectedProfileId(undefined);
    setSelectedTools([]);
    setInstallResults([]);
    setBusyLabel(uiMessage(locale, "busy.scanning"));
    setScreen("home");
    try {
      await refresh();
    } catch (caught) {
      setError(caughtMessage(caught));
    }
  }, [beginFlow, locale, refresh]);

  const discardPreview = useCallback(() => {
    if (preview) controller.cancelApply?.(preview.planId);
    setPreview(undefined);
  }, [controller, preview]);

  const goBack = useCallback(() => {
    const target = BACK_TARGETS[screen];
    if (!target || (screen === "language" && !snapshot)) return;

    beginFlow();
    setError(undefined);
    setResult(undefined);

    if (target === "home") {
      void returnHome();
      return;
    }

    if (screen === "install-preview") setSelectedTools([]);
    if (screen === "api-model") {
      pendingSecretRef.current = undefined;
      setModels([]);
    }
    if (screen === "assign-profile") setSelectedProfileId(undefined);
    if (screen === "apply-preview") discardPreview();
    if (screen === "remove-confirm") setSelectedProfileId(undefined);
    if (screen === "rollback-confirm") setSelectedTransactionId(undefined);
    setScreen(target);
  }, [beginFlow, discardPreview, returnHome, screen, snapshot]);

  useInput((_input, key) => {
    if (key.escape) goBack();
  });

  const missingTools = useMemo(
    () => snapshot?.statuses.filter((status) => !status.installed) ?? [],
    [snapshot],
  );

  const installedTools = useMemo(
    () => snapshot?.statuses.filter((status) => status.installed) ?? [],
    [snapshot],
  );

  const installPlans = useMemo(
    () => createInstallPlan(selectedTools),
    [selectedTools],
  );

  const selectedTool = selectedTools[0];
  const compatibleProfiles = useMemo(() => {
    if (!snapshot || !selectedTool) return [];
    const protocol = ACCEPTED_PROTOCOL[selectedTool];
    return snapshot.state.profiles.filter((profile) =>
      profile.protocols.includes(protocol),
    );
  }, [selectedTool, snapshot]);

  const handleWorkspace = useCallback(
    (value: WorkspaceAction) => {
      beginFlow();
      setError(undefined);
      if (value === "overview") {
        setBusyLabel(uiMessage(locale, "busy.scanning"));
        void refresh().catch((caught: unknown) => {
          setError(caughtMessage(caught));
        });
        return;
      }
      if (value === "profiles") {
        setScreen("profile-actions");
        return;
      }
      if (value === "clients") {
        setScreen("client-actions");
        return;
      }
      if (value === "changes") {
        setSelectedTransactionId(undefined);
        setScreen("rollback-select");
        return;
      }
      if (value === "doctor") {
        const epoch = beginFlow();
        setBusyLabel(uiMessage(locale, "busy.diagnostics"));
        setScreen("busy");
        void controller
          .doctor()
          .then((checks) => {
            if (!isCurrentFlow(epoch)) return;
            setDoctorChecks(checks);
            setScreen("doctor-result");
          })
          .catch((caught: unknown) => {
            if (!isCurrentFlow(epoch)) return;
            setError(caughtMessage(caught));
            setScreen("home");
          });
        return;
      }
      if (value === "settings") {
        setScreen("settings");
        return;
      }
      exit();
    },
    [beginFlow, controller, exit, isCurrentFlow, locale, refresh],
  );

  const loadModels = useCallback(
    async (secret: string) => {
      const epoch = beginFlow();
      const apiKey = secret.trim();
      if (!apiKey) {
        setError(uiMessage(locale, "profile.secretEmpty"));
        return;
      }
      pendingSecretRef.current = apiKey;
      setError(undefined);
      setBusyLabel(uiMessage(locale, "busy.fetchingModels"));
      setScreen("busy");
      try {
        const availableModels = await controller.fetchModels(apiKey);
        if (!isCurrentFlow(epoch)) return;
        const safeModels = [
          ...new Set(
            availableModels.filter((model) =>
              isTerminalIdentifier(model, MODEL_ID_LIMIT),
            ),
          ),
        ];
        if (safeModels.length === 0) {
          throw new Error(uiMessage(locale, "profile.noModels"));
        }
        setModels(safeModels);
        setScreen("api-model");
      } catch (caught) {
        if (!isCurrentFlow(epoch)) return;
        pendingSecretRef.current = undefined;
        setModels([]);
        setError(caughtMessage(caught));
        setScreen("api-secret");
      }
    },
    [beginFlow, controller, isCurrentFlow, locale],
  );

  const createApiProfile = useCallback(
    async (model: string) => {
      const epoch = beginFlow();
      const secret = pendingSecretRef.current;
      if (!secret) {
        setError(uiMessage(locale, "profile.secretEmpty"));
        setScreen("api-secret");
        return;
      }
      try {
        setError(undefined);
        setBusyLabel(uiMessage(locale, "busy.protectingCredential"));
        setScreen("busy");
        const profile = await controller.createProfile({
          name: draft.name ?? "",
          protocols: [...PROTOCOLS],
          secret,
          model,
        });
        if (!isCurrentFlow(epoch)) return;
        pendingSecretRef.current = undefined;
        setResult(
          uiMessage(locale, "profile.ready", {
            name: profile.name,
            model,
          }),
        );
        try {
          await refresh();
        } catch (caught) {
          if (!isCurrentFlow(epoch)) return;
          setError(caughtMessage(caught));
        }
        if (!isCurrentFlow(epoch)) return;
        setScreen("result");
      } catch (caught) {
        if (!isCurrentFlow(epoch)) return;
        setError(caughtMessage(caught));
        setScreen("api-model");
      }
    },
    [beginFlow, controller, draft.name, isCurrentFlow, locale, refresh],
  );

  const buildPreview = useCallback(
    async (profile: RelayProfile, tool: ToolId, model?: string) => {
      const epoch = beginFlow();
      try {
        setError(undefined);
        setSelectedProfileId(profile.id);
        setSelectedTools([tool]);
        setBusyLabel(uiMessage(locale, "busy.buildingPreview"));
        setScreen("busy");
        const nextPreview =
          model === undefined
            ? await controller.previewApply(profile.id, [tool])
            : await controller.previewApply(profile.id, [tool], model);
        if (!isCurrentFlow(epoch)) return;
        setPreview(nextPreview);
        setScreen("apply-preview");
      } catch (caught) {
        if (!isCurrentFlow(epoch)) return;
        setError(caughtMessage(caught));
        setScreen(
          tool === "claude" || model ? "assign-profile" : "assign-model",
        );
      }
    },
    [beginFlow, controller, isCurrentFlow, locale],
  );

  if (!snapshot) {
    return (
      <Box flexDirection="column" width={outputWidth} overflowX="hidden">
        <Header ascii={ascii} locale={locale} width={outputWidth} />
        {error ? (
          <Box flexDirection="column">
            <Alert variant="error">{error}</Alert>
            <Select
              options={[
                { label: uiMessage(locale, "common.retry"), value: "retry" },
                { label: uiMessage(locale, "common.exit"), value: "exit" },
              ]}
              onChange={(value) => {
                if (value === "exit") {
                  exit();
                  return;
                }
                setBusyLabel(uiMessage(locale, "busy.scanning"));
                void loadInitialSnapshot();
              }}
            />
          </Box>
        ) : (
          <Spinner label={busyLabel} />
        )}
      </Box>
    );
  }

  return (
    <Box flexDirection="column" width={outputWidth} overflowX="hidden">
      <Header ascii={ascii} locale={locale} width={outputWidth} />

      {error ? (
        <Box marginBottom={1}>
          <Alert variant="error">{error}</Alert>
        </Box>
      ) : null}

      {screen === "language" ? (
        <Box flexDirection="column">
          <Text bold>{uiMessage(locale, "language.prompt")}</Text>
          <Select
            options={languageOptions}
            onChange={(value) => {
              beginFlow();
              const nextLocale = value as UiLocale;
              setLocale(nextLocale);
              setBusyLabel(uiMessage(nextLocale, "busy.scanning"));
              setScreen("home");
            }}
          />
        </Box>
      ) : null}

      {screen === "home" ? (
        <Workspace
          ascii={ascii}
          locale={locale}
          snapshot={snapshot}
          width={outputWidth}
          onAction={handleWorkspace}
        />
      ) : null}

      {screen === "profile-actions" ? (
        <Prompt label={uiMessage(locale, "profiles.action")}>
          <Select
            options={[
              { label: uiMessage(locale, "profiles.add"), value: "add" },
              { label: uiMessage(locale, "profiles.test"), value: "test" },
              {
                label: uiMessage(locale, "profiles.remove"),
                value: "remove",
              },
              { label: uiMessage(locale, "common.back"), value: "back" },
            ]}
            onChange={(value) => {
              beginFlow();
              setError(undefined);
              if (value === "back") {
                void returnHome();
                return;
              }
              if (value === "add") {
                pendingSecretRef.current = undefined;
                setDraft({});
                setModels([]);
                setScreen("api-name");
                return;
              }
              setSelectedProfileId(undefined);
              setScreen(value === "test" ? "test-profile" : "remove-profile");
            }}
          />
        </Prompt>
      ) : null}

      {screen === "client-actions" ? (
        <Prompt label={uiMessage(locale, "clients.action")}>
          <Select
            options={[
              {
                label: uiMessage(locale, "clients.assign"),
                value: "assign",
              },
              {
                label: uiMessage(locale, "clients.install"),
                value: "install",
              },
              { label: uiMessage(locale, "common.back"), value: "back" },
            ]}
            onChange={(value) => {
              beginFlow();
              setError(undefined);
              if (value === "back") {
                void returnHome();
                return;
              }
              setSelectedTools([]);
              setScreen(value === "assign" ? "assign-tool" : "install-tools");
            }}
          />
        </Prompt>
      ) : null}

      {screen === "test-profile" ? (
        <Prompt label={uiMessage(locale, "test.profile")}>
          {snapshot.state.profiles.length === 0 ? (
            <EmptyAction
              locale={locale}
              message={uiMessage(locale, "test.createFirst")}
              onBack={goBack}
            />
          ) : (
            <Select
              visibleOptionCount={8}
              options={snapshot.state.profiles.map((profile) => ({
                label: terminalLine(profile.name, PROFILE_NAME_LIMIT),
                value: profile.id,
              }))}
              onChange={(profileId) => {
                const epoch = beginFlow();
                setBusyLabel(uiMessage(locale, "busy.testing"));
                setScreen("busy");
                void controller
                  .testConnection(profileId)
                  .then((checks) => {
                    if (!isCurrentFlow(epoch)) return;
                    setDoctorChecks(checks);
                    setScreen("doctor-result");
                  })
                  .catch((caught: unknown) => {
                    if (!isCurrentFlow(epoch)) return;
                    setError(caughtMessage(caught));
                    setScreen("test-profile");
                  });
              }}
            />
          )}
        </Prompt>
      ) : null}

      {screen === "remove-profile" ? (
        <Prompt label={uiMessage(locale, "remove.title")}>
          {snapshot.state.profiles.length === 0 ? (
            <EmptyAction
              locale={locale}
              message={uiMessage(locale, "remove.empty")}
              onBack={goBack}
            />
          ) : (
            <Select
              visibleOptionCount={8}
              options={snapshot.state.profiles.map((profile) => ({
                label: terminalLine(profile.name, PROFILE_NAME_LIMIT),
                value: profile.id,
              }))}
              onChange={(profileId) => {
                beginFlow();
                setError(undefined);
                setSelectedProfileId(profileId);
                setScreen("remove-confirm");
              }}
            />
          )}
        </Prompt>
      ) : null}

      {screen === "remove-confirm" && selectedProfileId ? (
        <Box flexDirection="column">
          <Text>
            {uiMessage(locale, "remove.confirm", {
              name:
                snapshot.state.profiles.find(
                  (profile) => profile.id === selectedProfileId,
                )?.name ?? selectedProfileId,
            })}
          </Text>
          <Text dimColor>{uiMessage(locale, "remove.credentialHint")}</Text>
          <ConfirmInput
            onConfirm={() => {
              const epoch = beginFlow();
              const target = selectedProfileId;
              setBusyLabel(uiMessage(locale, "busy.removingProfile"));
              setScreen("busy");
              void controller
                .deleteProfile(target)
                .then(async () => {
                  if (!isCurrentFlow(epoch)) return;
                  setSelectedProfileId(undefined);
                  setResult(uiMessage(locale, "remove.complete"));
                  await refresh();
                  if (!isCurrentFlow(epoch)) return;
                  setScreen("result");
                })
                .catch((caught: unknown) => {
                  if (!isCurrentFlow(epoch)) return;
                  setError(caughtMessage(caught));
                  setScreen("remove-profile");
                });
            }}
            onCancel={goBack}
          />
        </Box>
      ) : null}

      {screen === "install-tools" ? (
        <Prompt label={uiMessage(locale, "install.missingTitle")}>
          {missingTools.length === 0 ? (
            <EmptyAction
              locale={locale}
              message={uiMessage(locale, "install.allDetected")}
              onBack={() => void returnHome()}
            />
          ) : (
            <ControlledMultiSelect
              ascii={ascii}
              options={missingTools.map((status) => ({
                label: terminalLine(status.label, 80),
                value: status.id,
              }))}
              onSubmit={(values) => {
                if (values.length === 0) {
                  setError(uiMessage(locale, "install.selectOne"));
                  return;
                }
                beginFlow();
                setError(undefined);
                setSelectedTools(values as ToolId[]);
                setScreen("install-preview");
              }}
            />
          )}
        </Prompt>
      ) : null}

      {screen === "install-preview" ? (
        <Box flexDirection="column">
          <Text bold>{uiMessage(locale, "install.reviewTitle")}</Text>
          <Text dimColor>{uiMessage(locale, "install.fixedCommands")}</Text>
          <Box flexDirection="column" marginY={1}>
            {installPlans.map((plan) => (
              <Text key={plan.tool}>
                <Text color="cyan">{TOOL_LABELS[plan.tool]}</Text>
                {`  ${plan.displayCommand}`}
              </Text>
            ))}
          </Box>
          <StatusMessage variant="warning">
            {uiMessage(locale, "install.warning")}
          </StatusMessage>
          <Text>{uiMessage(locale, "install.confirm")}</Text>
          <ConfirmInput
            onConfirm={() => {
              const epoch = beginFlow();
              setBusyLabel(uiMessage(locale, "busy.installing"));
              setScreen("busy");
              void controller
                .installTools(selectedTools)
                .then(async (results) => {
                  if (!isCurrentFlow(epoch)) return;
                  setInstallResults(results);
                  try {
                    await refresh();
                  } catch (caught) {
                    if (!isCurrentFlow(epoch)) return;
                    setError(
                      uiMessage(locale, "install.refreshFailed", {
                        error: caughtMessage(caught),
                      }),
                    );
                  }
                  if (!isCurrentFlow(epoch)) return;
                  setScreen("install-result");
                })
                .catch((caught: unknown) => {
                  if (!isCurrentFlow(epoch)) return;
                  setError(caughtMessage(caught));
                  setScreen("install-preview");
                });
            }}
            onCancel={goBack}
          />
        </Box>
      ) : null}

      {screen === "install-result" ? (
        <Box flexDirection="column">
          <Text bold>{uiMessage(locale, "install.resultsTitle")}</Text>
          {installResults.map((installation) => {
            const detected = snapshot.statuses.find(
              (status) => status.id === installation.tool,
            )?.installed;
            const variant = !installation.success
              ? "error"
              : detected
                ? "success"
                : "warning";
            const detail = !installation.success
              ? `${
                  installation.exitCode === null
                    ? uiMessage(locale, "install.failed")
                    : uiMessage(locale, "install.failedCode", {
                        code: installation.exitCode,
                      })
                }${lastInstallerLine(installation.outputSummary)}`
              : detected
                ? uiMessage(locale, "install.detected")
                : uiMessage(locale, "install.pathMissing");
            return (
              <StatusMessage key={installation.tool} variant={variant}>
                {TOOL_LABELS[installation.tool]}: {detail}
              </StatusMessage>
            );
          })}
          <Select
            options={[
              {
                label: uiMessage(locale, "common.dashboard"),
                value: "home",
              },
              { label: uiMessage(locale, "common.exit"), value: "exit" },
            ]}
            onChange={(value) =>
              value === "exit" ? exit() : void returnHome()
            }
          />
        </Box>
      ) : null}

      {screen === "api-name" ? (
        <Prompt label={uiMessage(locale, "profile.name")}>
          <TextInput
            onSubmit={(name) => {
              const normalizedName = name.trim();
              if (normalizedName.length < 2) {
                setError(uiMessage(locale, "profile.nameTooShort"));
                return;
              }
              if (!isTerminalIdentifier(normalizedName, PROFILE_NAME_LIMIT)) {
                setError(uiMessage(locale, "profile.nameInvalid"));
                return;
              }
              setError(undefined);
              setDraft({ name: normalizedName });
              setScreen("api-secret");
            }}
          />
        </Prompt>
      ) : null}

      {screen === "api-secret" ? (
        <Prompt label={uiMessage(locale, "profile.secret")}>
          <PasswordInput onSubmit={(secret) => void loadModels(secret)} />
        </Prompt>
      ) : null}

      {screen === "api-model" ? (
        <Prompt
          label={uiMessage(locale, "profile.model", { count: models.length })}
        >
          <Select
            visibleOptionCount={8}
            options={models.map((model) => ({
              label: terminalLine(model, MODEL_ID_LIMIT),
              value: model,
            }))}
            onChange={(model) => void createApiProfile(model)}
          />
        </Prompt>
      ) : null}

      {screen === "assign-tool" ? (
        <Prompt label={uiMessage(locale, "assign.tool")}>
          {installedTools.length === 0 ? (
            <EmptyAction
              locale={locale}
              message={uiMessage(locale, "assign.noInstalled")}
              onBack={() => void returnHome()}
            />
          ) : (
            <Select
              options={installedTools.map((status) => ({
                label: terminalLine(status.label, 80),
                value: status.id,
              }))}
              onChange={(tool) => {
                beginFlow();
                setError(undefined);
                setSelectedTools([tool as ToolId]);
                setScreen("assign-profile");
              }}
            />
          )}
        </Prompt>
      ) : null}

      {screen === "assign-profile" && selectedTool ? (
        <Prompt
          label={uiMessage(locale, "assign.profile", {
            tool: TOOL_LABELS[selectedTool],
          })}
        >
          {compatibleProfiles.length === 0 ? (
            <EmptyAction
              locale={locale}
              message={uiMessage(locale, "assign.noProfiles")}
              onBack={goBack}
            />
          ) : (
            <Select
              visibleOptionCount={8}
              options={compatibleProfiles.map((profile) => ({
                label: terminalLine(
                  profile.model
                    ? `${profile.name}  ${profile.model}`
                    : `${profile.name}  ${uiMessage(locale, "assign.legacy")}`,
                  240,
                ),
                value: profile.id,
              }))}
              onChange={(profileId) => {
                const profile = compatibleProfiles.find(
                  (candidate) => candidate.id === profileId,
                );
                if (!profile) return;
                setSelectedProfileId(profile.id);
                if (
                  selectedTool !== "claude" &&
                  (!profile.model ||
                    !isTerminalIdentifier(profile.model, MODEL_ID_LIMIT))
                ) {
                  setScreen("assign-model");
                  return;
                }
                void buildPreview(
                  profile,
                  selectedTool,
                  selectedTool === "claude" ? undefined : profile.model,
                );
              }}
            />
          )}
        </Prompt>
      ) : null}

      {screen === "assign-model" && selectedTool && selectedProfileId ? (
        <Prompt label={uiMessage(locale, "assign.legacyModel")}>
          <TextInput
            onSubmit={(model) => {
              const profile = compatibleProfiles.find(
                (candidate) => candidate.id === selectedProfileId,
              );
              const normalizedModel = model.trim();
              if (!normalizedModel || !profile) {
                setError(uiMessage(locale, "apply.modelRequired"));
                return;
              }
              if (!isTerminalIdentifier(normalizedModel, MODEL_ID_LIMIT)) {
                setError(uiMessage(locale, "apply.modelInvalid"));
                return;
              }
              void buildPreview(profile, selectedTool, normalizedModel);
            }}
          />
        </Prompt>
      ) : null}

      {screen === "rollback-select" ? (
        <Prompt label={uiMessage(locale, "rollback.title")}>
          {snapshot.transactions.length === 0 ? (
            <EmptyAction
              locale={locale}
              message={uiMessage(locale, "rollback.empty")}
              onBack={goBack}
            />
          ) : (
            <Select
              visibleOptionCount={8}
              options={snapshot.transactions.map((transaction) => ({
                label: uiMessage(locale, "rollback.option", {
                  createdAt: transaction.createdAt,
                  count: transaction.files.length,
                }),
                value: transaction.id,
              }))}
              onChange={(transactionId) => {
                beginFlow();
                setError(undefined);
                setSelectedTransactionId(transactionId);
                setScreen("rollback-confirm");
              }}
            />
          )}
        </Prompt>
      ) : null}

      {screen === "rollback-confirm" && selectedTransactionId ? (
        <Box flexDirection="column">
          <Text>{uiMessage(locale, "rollback.confirm")}</Text>
          <Text dimColor>{terminalLine(selectedTransactionId, 120)}</Text>
          <ConfirmInput
            onConfirm={() => {
              const epoch = beginFlow();
              const target = selectedTransactionId;
              setBusyLabel(uiMessage(locale, "busy.restoring"));
              setScreen("busy");
              void controller
                .rollback(target)
                .then(async () => {
                  if (!isCurrentFlow(epoch)) return;
                  setSelectedTransactionId(undefined);
                  setResult(
                    uiMessage(locale, "rollback.complete", { id: target }),
                  );
                  await refresh();
                  if (!isCurrentFlow(epoch)) return;
                  setScreen("result");
                })
                .catch((caught: unknown) => {
                  if (!isCurrentFlow(epoch)) return;
                  setError(caughtMessage(caught));
                  setScreen("rollback-select");
                });
            }}
            onCancel={goBack}
          />
        </Box>
      ) : null}

      {screen === "doctor-result" ? (
        <Box flexDirection="column">
          <Text bold>{uiMessage(locale, "doctor.title")}</Text>
          {doctorChecks.map((check) => (
            <StatusMessage
              key={check.id}
              variant={
                check.status === "pass"
                  ? "success"
                  : check.status === "warn"
                    ? "warning"
                    : "error"
              }
            >
              {terminalLine(`${check.label}: ${check.detail}`, 800)}
            </StatusMessage>
          ))}
          <Select
            options={[
              { label: uiMessage(locale, "common.dashboard"), value: "home" },
              { label: uiMessage(locale, "common.exit"), value: "exit" },
            ]}
            onChange={(value) =>
              value === "exit" ? exit() : void returnHome()
            }
          />
        </Box>
      ) : null}

      {screen === "settings" ? (
        <Prompt label={uiMessage(locale, "settings.title")}>
          <Text dimColor>{snapshot.secretBackend}</Text>
          <Select
            options={[
              {
                label: uiMessage(locale, "settings.language"),
                value: "language",
              },
              { label: uiMessage(locale, "common.back"), value: "back" },
            ]}
            onChange={(value) => {
              if (value === "back") {
                void returnHome();
                return;
              }
              setScreen("language");
            }}
          />
        </Prompt>
      ) : null}

      {screen === "apply-preview" && preview ? (
        <Box flexDirection="column">
          <Text bold>{uiMessage(locale, "apply.review")}</Text>
          <Text dimColor>
            {uiMessage(locale, "apply.fileSummary", {
              count: preview.fileCount,
            })}
          </Text>
          <Box borderStyle="single" borderColor="gray" paddingX={1} marginY={1}>
            <Text wrap="wrap">
              {terminalMultiline(
                preview.diff || uiMessage(locale, "apply.noChanges"),
              )}
            </Text>
          </Box>
          {preview.notes.map((note, index) => (
            <StatusMessage key={index} variant="warning">
              {terminalLine(note, 800)}
            </StatusMessage>
          ))}
          <Text>{uiMessage(locale, "apply.confirm")}</Text>
          <ConfirmInput
            onConfirm={() => {
              const epoch = beginFlow();
              setBusyLabel(uiMessage(locale, "busy.applying"));
              setScreen("busy");
              void controller
                .apply(preview)
                .then(async (applied) => {
                  if (!isCurrentFlow(epoch)) return;
                  setPreview(undefined);
                  setResult(
                    uiMessage(locale, "apply.complete", {
                      tools: applied.tools
                        .map((tool) => TOOL_LABELS[tool])
                        .join(", "),
                      id: applied.transactionId,
                    }),
                  );
                  try {
                    await refresh();
                  } catch (caught) {
                    if (!isCurrentFlow(epoch)) return;
                    setError(caughtMessage(caught));
                  }
                  if (!isCurrentFlow(epoch)) return;
                  setScreen("result");
                })
                .catch((caught: unknown) => {
                  if (!isCurrentFlow(epoch)) return;
                  controller.cancelApply?.(preview.planId);
                  setPreview(undefined);
                  setError(caughtMessage(caught));
                  setScreen("assign-profile");
                });
            }}
            onCancel={goBack}
          />
        </Box>
      ) : null}

      {screen === "busy" ? <Spinner label={busyLabel} /> : null}

      {screen === "result" && result ? (
        <Box flexDirection="column">
          <StatusMessage variant="success">{result}</StatusMessage>
          <Select
            options={[
              {
                label: uiMessage(locale, "common.dashboard"),
                value: "home",
              },
              { label: uiMessage(locale, "common.exit"), value: "exit" },
            ]}
            onChange={(value) =>
              value === "exit" ? exit() : void returnHome()
            }
          />
        </Box>
      ) : null}
    </Box>
  );
}

function lastInstallerLine(summary: string): string {
  const line = summary
    .split(/\r?\n/u)
    .map((item) => item.trim())
    .filter(Boolean)
    .at(-1);
  const safeLine = terminalLine(line ?? "", 240);
  return safeLine ? ` ${safeLine}` : "";
}

function Prompt({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <Box flexDirection="column">
      <Text bold>{label}</Text>
      {children}
    </Box>
  );
}

function EmptyAction({
  locale,
  message,
  onBack,
}: {
  locale: UiLocale;
  message: string;
  onBack: () => void;
}) {
  return (
    <Box flexDirection="column">
      <StatusMessage variant="info">{message}</StatusMessage>
      <Select
        options={[{ label: uiMessage(locale, "common.back"), value: "back" }]}
        onChange={onBack}
      />
    </Box>
  );
}
