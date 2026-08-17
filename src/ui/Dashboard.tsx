import React from "react";
import { Box, Text } from "ink";
import { RELAY_BASE_URL } from "../constants.js";
import { terminalLine } from "../terminal.js";
import type { AppState, ToolStatus } from "../types.js";
import { uiMessage, type UiLocale } from "./i18n.js";

export interface DashboardProps {
  locale?: UiLocale;
  ascii?: boolean;
  state: AppState;
  statuses: ToolStatus[];
  secretBackend: string;
  secretBackendSecure: boolean;
  width?: number;
}

export function Dashboard({
  locale = "en",
  ascii = false,
  state,
  statuses,
  secretBackend,
  secretBackendSecure,
  width,
}: DashboardProps) {
  const installedCount = statuses.filter((status) => status.installed).length;
  const bindingCount = Object.values(state.bindings).filter(Boolean).length;
  const terminalWidth = Math.max(1, width ?? process.stdout.columns ?? 80);
  const compact = terminalWidth < 44;

  return (
    <Box flexDirection="column" marginBottom={1}>
      <Box width={terminalWidth} overflowX="hidden" flexDirection="column">
        <Box gap={1}>
          <Text bold>{uiMessage(locale, "dashboard.workspace")}</Text>
          <Text dimColor wrap="truncate-end">
            {new URL(RELAY_BASE_URL).host}
          </Text>
        </Box>
        <Box gap={compact ? 1 : 2} flexWrap="wrap">
          <Text dimColor>{uiMessage(locale, "dashboard.tools")}</Text>
          <Text color="cyan" bold>
            {uiMessage(locale, "dashboard.installedCount", {
              count: installedCount,
            })}
          </Text>
          <Text dimColor>{uiMessage(locale, "dashboard.apiCount")}</Text>
          <Text color="cyan" bold>
            {state.profiles.length}
          </Text>
          <Text dimColor>{uiMessage(locale, "dashboard.linkedCount")}</Text>
          <Text color={bindingCount > 0 ? "green" : "gray"} bold>
            {bindingCount}
          </Text>
        </Box>
      </Box>
      <Box marginTop={1}>
        <Text dimColor>{uiMessage(locale, "dashboard.tools")}</Text>
      </Box>
      {statuses.map((status) => {
        const binding = state.bindings[status.id];
        const needsReapply = Boolean(binding && !status.configured);
        const profile = state.profiles.find(
          (item) => item.id === binding?.profileId,
        );
        const statusColor = !status.installed
          ? "red"
          : needsReapply
            ? "yellow"
            : "green";
        const statusText = !status.installed
          ? ascii
            ? "x"
            : uiMessage(locale, "dashboard.missing")
          : needsReapply
            ? uiMessage(locale, "dashboard.reapply")
            : status.configured
              ? uiMessage(locale, "dashboard.ready")
              : uiMessage(locale, "dashboard.detected");
        const detail = needsReapply
          ? profile
            ? uiMessage(locale, "dashboard.needsReapplyProfile", {
                profile: profile.name,
              })
            : uiMessage(locale, "dashboard.needsReapply")
          : profile
            ? terminalLine(profile.name, 100)
            : uiMessage(locale, "dashboard.notConfigured");
        const detailColor = needsReapply
          ? "yellow"
          : profile
            ? "cyan"
            : undefined;

        return compact ? (
          <Box
            key={status.id}
            flexDirection="column"
            width={terminalWidth}
            overflowX="hidden"
          >
            <Box gap={1} width={terminalWidth} overflowX="hidden">
              <Text color={statusColor} bold>
                {statusText}
              </Text>
              <Text wrap="truncate-end">{terminalLine(status.label, 80)}</Text>
            </Box>
            <Box marginLeft={2} width={Math.max(1, terminalWidth - 2)}>
              <Text
                {...(detailColor ? { color: detailColor } : { dimColor: true })}
                wrap="truncate-end"
              >
                {detail}
              </Text>
            </Box>
          </Box>
        ) : (
          <Box key={status.id} gap={1} width={terminalWidth} overflowX="hidden">
            <Box width={10}>
              <Text color={statusColor} bold>
                {statusText}
              </Text>
            </Box>
            <Box width={16}>
              <Text wrap="truncate-end">{terminalLine(status.label, 80)}</Text>
            </Box>
            <Text
              {...(detailColor ? { color: detailColor } : { dimColor: true })}
              wrap="truncate-end"
            >
              {detail}
            </Text>
          </Box>
        );
      })}
      <Box
        gap={1}
        marginTop={1}
        width={terminalWidth}
        overflowX="hidden"
        flexWrap={compact ? "wrap" : "nowrap"}
      >
        <Text dimColor>{uiMessage(locale, "dashboard.secrets")}</Text>
        <Text color={secretBackendSecure ? "green" : "yellow"} bold>
          {secretBackendSecure
            ? uiMessage(locale, "dashboard.protected")
            : uiMessage(locale, "dashboard.fallback")}
        </Text>
        <Text dimColor wrap="truncate-end">
          {terminalLine(secretBackend, 160)}
        </Text>
      </Box>
    </Box>
  );
}
