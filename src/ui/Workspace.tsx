import React, { useMemo, useRef, useState } from "react";
import { Box, Text, useInput } from "ink";
import { RELAY_BASE_URL } from "../constants.js";
import { terminalLine } from "../terminal.js";
import { Dashboard } from "./Dashboard.js";
import { uiMessage, type UiLocale } from "./i18n.js";
import type { UiSnapshot } from "./types.js";

export type WorkspaceAction =
  | "overview"
  | "profiles"
  | "clients"
  | "changes"
  | "doctor"
  | "settings"
  | "exit";

interface WorkspaceItem {
  action: WorkspaceAction;
  label: string;
  badge?: string;
  badgeColor?: "cyan" | "green" | "red" | "yellow" | "gray";
}

export interface WorkspaceProps {
  ascii?: boolean;
  locale: UiLocale;
  snapshot: UiSnapshot;
  width: number;
  onAction: (action: WorkspaceAction) => void;
}

const ARROW_UP = "\u001B[A";
const ARROW_DOWN = "\u001B[B";

function countSequence(input: string, sequence: string): number {
  let count = 0;
  let offset = 0;
  while ((offset = input.indexOf(sequence, offset)) !== -1) {
    count += 1;
    offset += sequence.length;
  }
  return count;
}

function wrapIndex(index: number, length: number): number {
  return ((index % length) + length) % length;
}

export function Workspace({
  ascii = false,
  locale,
  snapshot,
  width,
  onAction,
}: WorkspaceProps) {
  const [focusedIndex, setFocusedIndex] = useState(0);
  const focusedIndexRef = useRef(0);
  const onActionRef = useRef(onAction);
  onActionRef.current = onAction;

  const items = useMemo<WorkspaceItem[]>(() => {
    const installed = snapshot.statuses.filter((status) => status.installed);
    const configured = snapshot.statuses.filter((status) => status.configured);
    const pending = snapshot.transactions.filter(
      (transaction) => transaction.status !== "rolled-back",
    );
    const unhealthy = snapshot.statuses.filter(
      (status) => !status.installed || !status.configured,
    );
    return [
      {
        action: "overview",
        label: uiMessage(locale, "workspace.overview"),
        badge: uiMessage(locale, "workspace.online"),
        badgeColor: "green",
      },
      {
        action: "profiles",
        label: uiMessage(locale, "workspace.profiles"),
        badge: String(snapshot.state.profiles.length),
        badgeColor: snapshot.state.profiles.length > 0 ? "cyan" : "gray",
      },
      {
        action: "clients",
        label: uiMessage(locale, "workspace.clients"),
        badge: `${configured.length}/${installed.length || snapshot.statuses.length}`,
        badgeColor: configured.length > 0 ? "cyan" : "gray",
      },
      {
        action: "changes",
        label: uiMessage(locale, "workspace.changes"),
        badge: String(pending.length),
        badgeColor: pending.length > 0 ? "yellow" : "gray",
      },
      {
        action: "doctor",
        label: uiMessage(locale, "workspace.doctor"),
        badge: unhealthy.length === 0 ? "OK" : String(unhealthy.length),
        badgeColor: unhealthy.length === 0 ? "green" : "yellow",
      },
      {
        action: "settings",
        label: uiMessage(locale, "workspace.settings"),
      },
      {
        action: "exit",
        label: uiMessage(locale, "common.exit"),
      },
    ];
  }, [locale, snapshot]);

  useInput((input, key) => {
    const upCount = countSequence(input, ARROW_UP);
    const downCount = countSequence(input, ARROW_DOWN);
    const movement =
      upCount > 0 || downCount > 0
        ? downCount - upCount
        : key.downArrow || input === "j"
          ? 1
          : key.upArrow || input === "k"
            ? -1
            : 0;
    let nextIndex = focusedIndexRef.current;
    if (movement !== 0) {
      nextIndex = wrapIndex(nextIndex + movement, items.length);
      focusedIndexRef.current = nextIndex;
      setFocusedIndex(nextIndex);
    }
    if (key.return || input.includes("\r") || input.includes("\n")) {
      onActionRef.current(items[nextIndex]!.action);
    }
  });

  const focused = items[focusedIndex]!;
  const compact = width < 68;
  const sidebarWidth = Math.min(24, Math.max(18, Math.floor(width * 0.28)));

  return (
    <Box
      borderStyle="single"
      borderColor="gray"
      flexDirection={compact ? "column" : "row"}
      width={width}
      minHeight={compact ? undefined : 20}
      overflowX="hidden"
    >
      <Box
        flexDirection="column"
        width={compact ? width - 2 : sidebarWidth}
        paddingX={1}
        borderStyle={compact ? undefined : "single"}
        borderTop={false}
        borderBottom={false}
        borderLeft={false}
        borderRight={!compact}
        borderColor="gray"
      >
        <Text bold color="yellow">
          {uiMessage(locale, "workspace.navigation")}
        </Text>
        <Box flexDirection={compact ? "row" : "column"} flexWrap="wrap">
          {items.map((item, index) => {
            const selected = index === focusedIndex;
            return (
              <Box
                key={item.action}
                gap={1}
                marginRight={compact ? 2 : 0}
                marginTop={compact ? 0 : 1}
              >
                <Text
                  {...(selected ? { color: "cyan" as const, bold: true } : {})}
                >
                  {selected ? (ascii ? ">" : "›") : " "} {item.label}
                </Text>
                {item.badge ? (
                  <Text color={item.badgeColor ?? "gray"}>{item.badge}</Text>
                ) : null}
              </Box>
            );
          })}
        </Box>
      </Box>

      <Box
        flexDirection="column"
        paddingX={1}
        width={compact ? width - 2 : Math.max(1, width - sidebarWidth - 2)}
        overflowX="hidden"
      >
        <Box justifyContent="space-between">
          <Text bold>{focused.label}</Text>
          <Text dimColor>{new URL(RELAY_BASE_URL).host}</Text>
        </Box>
        <Box marginTop={1} flexDirection="column">
          <WorkspacePage
            action={focused.action}
            ascii={ascii}
            locale={locale}
            snapshot={snapshot}
            width={compact ? width - 4 : Math.max(1, width - sidebarWidth - 4)}
          />
        </Box>
      </Box>
    </Box>
  );
}

function WorkspacePage({
  action,
  ascii,
  locale,
  snapshot,
  width,
}: {
  action: WorkspaceAction;
  ascii: boolean;
  locale: UiLocale;
  snapshot: UiSnapshot;
  width: number;
}) {
  if (action === "overview") {
    return (
      <Dashboard
        locale={locale}
        ascii={ascii}
        state={snapshot.state}
        statuses={snapshot.statuses}
        secretBackend={snapshot.secretBackend}
        secretBackendSecure={snapshot.secretBackendSecure}
        width={width}
      />
    );
  }

  if (action === "profiles") {
    if (snapshot.state.profiles.length === 0) {
      return <Text dimColor>{uiMessage(locale, "workspace.noProfiles")}</Text>;
    }
    return (
      <Box flexDirection="column">
        {snapshot.state.profiles.slice(0, 8).map((profile) => {
          const bindings = Object.values(snapshot.state.bindings).filter(
            (binding) => binding?.profileId === profile.id,
          );
          return (
            <Box key={profile.id} justifyContent="space-between">
              <Text color="cyan">
                {terminalLine(profile.name, Math.max(8, width - 24))}
              </Text>
              <Text dimColor>
                {terminalLine(profile.model ?? "-", 18)} {bindings.length}
              </Text>
            </Box>
          );
        })}
      </Box>
    );
  }

  if (action === "clients") {
    return (
      <Box flexDirection="column">
        {snapshot.statuses.map((status) => {
          const binding = snapshot.state.bindings[status.id];
          const profile = snapshot.state.profiles.find(
            (candidate) => candidate.id === binding?.profileId,
          );
          const marker = !status.installed
            ? ascii
              ? "x"
              : "×"
            : status.configured
              ? ascii
                ? "ok"
                : "●"
              : ascii
                ? "!"
                : "○";
          const color = !status.installed
            ? "red"
            : status.configured
              ? "green"
              : "yellow";
          return (
            <Box key={status.id} gap={1}>
              <Text color={color}>{marker}</Text>
              <Box width={16}>
                <Text>{terminalLine(status.label, 40)}</Text>
              </Box>
              <Text dimColor wrap="truncate-end">
                {terminalLine(
                  profile?.name ?? uiMessage(locale, "dashboard.notConfigured"),
                  Math.max(8, width - 20),
                )}
              </Text>
            </Box>
          );
        })}
      </Box>
    );
  }

  if (action === "changes") {
    if (snapshot.transactions.length === 0) {
      return <Text dimColor>{uiMessage(locale, "workspace.noChanges")}</Text>;
    }
    return (
      <Box flexDirection="column">
        {snapshot.transactions.slice(0, 8).map((transaction) => (
          <Box key={transaction.id} justifyContent="space-between">
            <Text>
              {terminalLine(transaction.id, Math.max(12, width - 24))}
            </Text>
            <Text color={transaction.status === "applied" ? "yellow" : "gray"}>
              {transaction.status ?? "applied"}
            </Text>
          </Box>
        ))}
      </Box>
    );
  }

  if (action === "doctor") {
    const issues = snapshot.statuses.filter(
      (status) => !status.installed || !status.configured,
    );
    return (
      <Box flexDirection="column">
        <Text color={snapshot.secretBackendSecure ? "green" : "yellow"}>
          {snapshot.secretBackendSecure ? (ascii ? "[OK]" : "●") : "!"}{" "}
          {uiMessage(locale, "dashboard.secrets")}: {snapshot.secretBackend}
        </Text>
        <Text color={issues.length === 0 ? "green" : "yellow"}>
          {issues.length === 0 ? (ascii ? "[OK]" : "●") : "!"}{" "}
          {uiMessage(locale, "workspace.issueCount", { count: issues.length })}
        </Text>
      </Box>
    );
  }

  if (action === "settings") {
    return (
      <Box flexDirection="column">
        <Text>
          <Text dimColor>{uiMessage(locale, "workspace.endpoint")}: </Text>
          {RELAY_BASE_URL}
        </Text>
        <Text>
          <Text dimColor>{uiMessage(locale, "dashboard.secrets")}: </Text>
          {snapshot.secretBackend}
        </Text>
        <Text>
          <Text dimColor>{uiMessage(locale, "workspace.language")}: </Text>
          {locale === "zh-CN" ? "简体中文" : "English"}
        </Text>
      </Box>
    );
  }

  return <Text dimColor>{uiMessage(locale, "workspace.exitReady")}</Text>;
}
