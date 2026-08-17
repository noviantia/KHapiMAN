type TerminalInputChunk = string | Uint8Array;

export interface TerminalInputNormalizer {
  normalize(chunk: string): string;
  normalize(chunk: Uint8Array): Uint8Array;
  reset(): void;
}

// Ink names LF "enter", while @inkjs/ui controls submit only on "return".
export function createTerminalInputNormalizer(): TerminalInputNormalizer {
  let previousChunkEndedWithCarriageReturn = false;

  function normalize(chunk: string): string;
  function normalize(chunk: Uint8Array): Uint8Array;
  function normalize(chunk: TerminalInputChunk): TerminalInputChunk {
    if (typeof chunk === "string") {
      let output = "";
      let sliceStart = 0;

      for (let index = 0; index < chunk.length; index += 1) {
        const character = chunk[index];
        if (character === "\n") {
          output += chunk.slice(sliceStart, index);
          if (!previousChunkEndedWithCarriageReturn) output += "\r";
          sliceStart = index + 1;
        }
        previousChunkEndedWithCarriageReturn = character === "\r";
      }

      return sliceStart === 0 ? chunk : output + chunk.slice(sliceStart);
    }

    const output = Buffer.isBuffer(chunk)
      ? Buffer.allocUnsafe(chunk.length)
      : new Uint8Array(chunk.length);
    let outputIndex = 0;

    for (let index = 0; index < chunk.length; index += 1) {
      const byte = chunk[index]!;
      if (byte === 0x0a) {
        if (!previousChunkEndedWithCarriageReturn) {
          output[outputIndex] = 0x0d;
          outputIndex += 1;
        }
      } else {
        output[outputIndex] = byte;
        outputIndex += 1;
      }
      previousChunkEndedWithCarriageReturn = byte === 0x0d;
    }

    return output.subarray(0, outputIndex);
  }

  return {
    normalize,
    reset() {
      previousChunkEndedWithCarriageReturn = false;
    },
  };
}

export function normalizeTerminalStdin(
  stdin: NodeJS.ReadStream,
): NodeJS.ReadStream {
  const normalizer = createTerminalInputNormalizer();
  const normalizedRead = (size?: number): unknown => {
    const chunk: unknown = stdin.read(size);
    if (chunk === null) normalizer.reset();
    if (typeof chunk === "string") return normalizer.normalize(chunk);
    if (chunk instanceof Uint8Array) return normalizer.normalize(chunk);
    return chunk;
  };

  return new Proxy(stdin, {
    get(target, property) {
      if (property === "read") return normalizedRead;
      const value: unknown = Reflect.get(target, property, target);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}
