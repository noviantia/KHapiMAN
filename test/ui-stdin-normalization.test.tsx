import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";

import { ConfirmInput } from "@inkjs/ui";
import { render } from "ink";
import React from "react";
import { describe, expect, it, vi } from "vitest";

import {
  createTerminalInputNormalizer,
  normalizeTerminalStdin,
} from "../src/ui/normalize-stdin.js";

class TestStdin extends EventEmitter {
  readonly isTTY = true;
  readonly rawModeCalls: boolean[] = [];
  readonly encodingCalls: BufferEncoding[] = [];
  refCalls = 0;
  unrefCalls = 0;
  #chunks: Array<string | Buffer> = [];

  write(chunk: string | Buffer): void {
    this.#chunks.push(chunk);
    this.emit("readable");
  }

  read(): string | Buffer | null {
    return this.#chunks.shift() ?? null;
  }

  setEncoding(encoding: BufferEncoding): this {
    this.encodingCalls.push(encoding);
    return this;
  }

  setRawMode(enabled: boolean): this {
    this.rawModeCalls.push(enabled);
    return this;
  }

  ref(): this {
    this.refCalls += 1;
    return this;
  }

  unref(): this {
    this.unrefCalls += 1;
    return this;
  }

  resume(): this {
    return this;
  }

  pause(): this {
    return this;
  }
}

function asReadStream(stdin: TestStdin): NodeJS.ReadStream {
  return stdin as unknown as NodeJS.ReadStream;
}

function asWriteStream(stream: PassThrough): NodeJS.WriteStream {
  return stream as unknown as NodeJS.WriteStream;
}

describe("terminal input normalization", () => {
  it("maps LF and CRLF to one CR while preserving existing CR", () => {
    const normalizer = createTerminalInputNormalizer();

    expect(normalizer.normalize("alpha\nbeta\r\ngamma\r")).toBe(
      "alpha\rbeta\rgamma\r",
    );
  });

  it("collapses CRLF split across adjacent raw input chunks", () => {
    const normalizer = createTerminalInputNormalizer();

    expect(normalizer.normalize("first\r")).toBe("first\r");
    expect(normalizer.normalize("\nsecond\n")).toBe("second\r");
  });

  it("does not merge separate CR and LF keypresses after the stream drains", () => {
    const source = new TestStdin();
    const stdin = normalizeTerminalStdin(asReadStream(source));

    source.write("\r");
    expect(stdin.read()).toBe("\r");
    expect(stdin.read()).toBeNull();

    source.write("\n");
    expect(stdin.read()).toBe("\r");
  });

  it("normalizes byte chunks without changing their representation", () => {
    const normalizer = createTerminalInputNormalizer();
    const normalized = normalizer.normalize(
      Buffer.from([0x61, 0x0a, 0x62, 0x0d, 0x0a]),
    );

    expect(Buffer.isBuffer(normalized)).toBe(true);
    expect([...normalized]).toEqual([0x61, 0x0d, 0x62, 0x0d]);
  });

  it("delegates raw-mode lifecycle and events to the original stream", () => {
    const source = new TestStdin();
    const stdin = normalizeTerminalStdin(asReadStream(source));
    const readable = vi.fn();

    stdin.on("readable", readable);
    stdin.setEncoding("utf8");
    stdin.setRawMode(true);
    stdin.ref();
    stdin.unref();
    source.write("\n");

    expect(readable).toHaveBeenCalledOnce();
    expect(stdin.read()).toBe("\r");
    expect(source.encodingCalls).toEqual(["utf8"]);
    expect(source.rawModeCalls).toEqual([true]);
    expect(source.refCalls).toBe(1);
    expect(source.unrefCalls).toBe(1);
  });

  it("lets an @inkjs/ui control submit when the terminal sends LF", async () => {
    const source = new TestStdin();
    const stdout = new PassThrough();
    const stderr = new PassThrough();
    const onConfirm = vi.fn();
    const instance = render(
      <ConfirmInput onConfirm={onConfirm} onCancel={vi.fn()} />,
      {
        stdin: normalizeTerminalStdin(asReadStream(source)),
        stdout: asWriteStream(stdout),
        stderr: asWriteStream(stderr),
        debug: true,
        exitOnCtrlC: false,
        patchConsole: false,
      },
    );

    try {
      await vi.waitFor(() => {
        expect(source.listenerCount("readable")).toBeGreaterThan(0);
        expect(source.rawModeCalls).toContain(true);
      });

      source.write("\n");

      await vi.waitFor(() => {
        expect(onConfirm).toHaveBeenCalledOnce();
      });
    } finally {
      instance.unmount();
      await instance.waitUntilExit();
      stdout.destroy();
      stderr.destroy();
    }

    expect(source.rawModeCalls).toContain(false);
  });
});
