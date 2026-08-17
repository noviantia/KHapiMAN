import React from "react";
import { Box, Text } from "ink";
import { APP_VERSION } from "../constants.js";
import { uiMessage, type UiLocale } from "./i18n.js";

export interface HeaderProps {
  ascii?: boolean;
  locale?: UiLocale;
  width?: number;
}

export function Header({ ascii = false, locale = "en" }: HeaderProps) {
  const tagline = uiMessage(locale, "header.tagline");

  return (
    <Box justifyContent="space-between" marginBottom={1}>
      <Box gap={1}>
        <Text bold color="yellow">
          {ascii ? ">_" : "›_"}
        </Text>
        <Text bold>KHapiMAN</Text>
        <Text dimColor>v{APP_VERSION}</Text>
      </Box>
      <Text dimColor>{ascii ? tagline.replaceAll("·", "-") : tagline}</Text>
    </Box>
  );
}
