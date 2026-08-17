import { beforeEach, describe, expect, it, vi } from "vitest";
import type * as InkModule from "ink";

import type { KhapimanController } from "../src/ui/types.js";

const { renderMock, waitUntilExitMock } = vi.hoisted(() => ({
  renderMock: vi.fn(),
  waitUntilExitMock: vi.fn(async () => undefined),
}));

vi.mock("ink", async (importOriginal) => ({
  ...(await importOriginal<typeof InkModule>()),
  render: renderMock,
}));

import { runInteractive } from "../src/ui/run.js";

describe("interactive terminal rendering", () => {
  beforeEach(() => {
    renderMock.mockReset();
    waitUntilExitMock.mockClear();
    renderMock.mockReturnValue({ waitUntilExit: waitUntilExitMock });
  });

  it("anchors the TUI and redraws only changed lines", async () => {
    await runInteractive({} as KhapimanController, { ascii: true });

    expect(renderMock).toHaveBeenCalledOnce();
    expect(renderMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        alternateScreen: true,
        incrementalRendering: true,
        stdin: expect.anything(),
      }),
    );
    expect(waitUntilExitMock).toHaveBeenCalledOnce();
  });
});
