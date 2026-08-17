import React from "react";
import { render } from "ink";
import type { KhapimanController } from "./types.js";
import { App } from "./App.js";
import { normalizeTerminalStdin } from "./normalize-stdin.js";

export async function runInteractive(
  controller: KhapimanController,
  options: { ascii?: boolean } = {},
): Promise<void> {
  const instance = render(
    <App controller={controller} ascii={options.ascii ?? false} />,
    {
      stdin: normalizeTerminalStdin(process.stdin),
      alternateScreen: true,
      incrementalRendering: true,
    },
  );
  await instance.waitUntilExit();
}
