export interface TerminalTextOptions {
  multiline?: boolean;
  maxLength?: number;
}

const ESCAPE = 0x1b;
const BELL = 0x07;
const CSI = 0x9b;
const OSC = 0x9d;

function escapeSequenceEnd(value: string, start: number): number {
  const introducer = value.charCodeAt(start);
  const next = value.charCodeAt(start + 1);
  const isCsi = introducer === CSI || (introducer === ESCAPE && next === 0x5b);
  if (isCsi) {
    let index = start + (introducer === CSI ? 1 : 2);
    while (index < value.length) {
      const code = value.charCodeAt(index);
      index += 1;
      if (code >= 0x40 && code <= 0x7e) return index;
    }
    return value.length;
  }

  const isOsc = introducer === OSC || (introducer === ESCAPE && next === 0x5d);
  if (isOsc) {
    let index = start + (introducer === OSC ? 1 : 2);
    while (index < value.length) {
      const code = value.charCodeAt(index);
      if (code === BELL) return index + 1;
      if (code === ESCAPE && value.charCodeAt(index + 1) === 0x5c) {
        return index + 2;
      }
      index += 1;
    }
    return value.length;
  }

  return Math.min(value.length, start + (introducer === ESCAPE ? 2 : 1));
}

function isUnicodeControl(character: string): boolean {
  return /\p{C}/u.test(character);
}

function limitText(value: string, maxLength: number): string {
  if (!Number.isFinite(maxLength)) return value;
  const limit = Math.max(0, Math.floor(maxLength));
  const characters = [...value];
  if (characters.length <= limit) return value;
  if (limit <= 3) return ".".repeat(limit);
  return `${characters.slice(0, limit - 3).join("")}...`;
}

export function sanitizeTerminalText(
  value: unknown,
  options: TerminalTextOptions = {},
): string {
  const source = String(value);
  const multiline = options.multiline ?? false;
  let output = "";

  for (let index = 0; index < source.length;) {
    const code = source.charCodeAt(index);
    if (code === ESCAPE || code === CSI || code === OSC) {
      index = escapeSequenceEnd(source, index);
      continue;
    }

    const character = String.fromCodePoint(source.codePointAt(index)!);
    index += character.length;

    if (character === "\r") {
      if (source[index] === "\n") index += 1;
      output += multiline ? "\n" : " ";
      continue;
    }
    if (
      character === "\n" ||
      character === "\u2028" ||
      character === "\u2029"
    ) {
      output += multiline ? "\n" : " ";
      continue;
    }
    if (character === "\t") {
      output += " ";
      continue;
    }
    if (isUnicodeControl(character)) continue;
    output += character;
  }

  const normalized = multiline ? output : output.trim();
  return limitText(normalized, options.maxLength ?? Number.POSITIVE_INFINITY);
}

export function terminalLine(value: unknown, maxLength = 512): string {
  return sanitizeTerminalText(value, { maxLength });
}

export function terminalMultiline(
  value: unknown,
  maxLength = Number.POSITIVE_INFINITY,
): string {
  return sanitizeTerminalText(value, { multiline: true, maxLength });
}

export function isTerminalIdentifier(
  value: string,
  maxLength: number,
): boolean {
  const normalized = value.trim();
  return (
    normalized.length > 0 && normalized === terminalLine(normalized, maxLength)
  );
}

export function requireTerminalIdentifier(
  value: string,
  label: string,
  maxLength: number,
): string {
  const normalized = value.trim();
  if (!isTerminalIdentifier(normalized, maxLength)) {
    throw new Error(
      `${label} must be a single-line printable value of at most ${maxLength} characters.`,
    );
  }
  return normalized;
}
