const REDACTED = "[REDACTED]";

function replaceAllLiteral(value: string, needle: string): string {
  return needle.length === 0 ? value : value.split(needle).join(REDACTED);
}

export function redactSensitiveText(
  value: string,
  secrets: readonly string[] = [],
): string {
  let redacted = value;
  const uniqueSecrets = [...new Set(secrets)]
    .filter((secret) => secret.length > 0)
    .sort((left, right) => right.length - left.length);

  for (const secret of uniqueSecrets) {
    redacted = replaceAllLiteral(redacted, secret);
  }

  redacted = redacted.replace(
    /((?:["']?authorization["']?\s*[:=]\s*)["']?)([^\r\n"']+)(["']?)/gi,
    `$1${REDACTED}$3`,
  );
  redacted = redacted.replace(
    /(Bearer\s+)[A-Za-z0-9._~+/=-]+/gi,
    `$1${REDACTED}`,
  );
  redacted = redacted.replace(
    /((?:["']?(?:api[_-]?key|access[_-]?token|auth[_-]?token|password|authorization)["']?\s*[:=]\s*)["']?)([^"'\s,}\]]+)(["']?)/gi,
    `$1${REDACTED}$3`,
  );
  redacted = redacted.replace(
    /\b(?:sk|key|token)-[A-Za-z0-9_-]{12,}\b/g,
    REDACTED,
  );

  return redacted;
}

export { REDACTED };
