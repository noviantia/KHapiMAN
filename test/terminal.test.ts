import { describe, expect, it } from "vitest";

import {
  isTerminalIdentifier,
  requireTerminalIdentifier,
  terminalLine,
  terminalMultiline,
} from "../src/terminal.js";

describe("terminal text boundaries", () => {
  it("removes terminal control sequences and folds dynamic text to one line", () => {
    expect(
      terminalLine(
        "\u001b]0;forged title\u0007\u001b[31mFailure\u001b[0m\nnext\tline",
      ),
    ).toBe("Failure next line");
  });

  it("preserves newlines for reviewable text while removing controls", () => {
    expect(terminalMultiline("first\r\n\u001b[2Jsecond\nthird")).toBe(
      "first\nsecond\nthird",
    );
  });

  it("bounds output and rejects unsafe user-facing identifiers", () => {
    expect(terminalLine("abcdefghijklmnop", 10)).toBe("abcdefg...");
    expect(isTerminalIdentifier("relay-model", 20)).toBe(true);
    expect(isTerminalIdentifier("relay\nmodel", 20)).toBe(false);
    expect(isTerminalIdentifier("\u001b[31mrelay", 20)).toBe(false);
    expect(isTerminalIdentifier("relay\u202emodel", 20)).toBe(false);
    expect(() =>
      requireTerminalIdentifier("relay\nmodel", "Model ID", 20),
    ).toThrow("single-line printable");
  });
});
