# Security Policy

KHapiMAN handles API credentials and edits user-level configuration files. Security reports deserve a private channel and enough detail to reproduce the issue without exposing a real credential.

## Supported versions

Security fixes are provided for the latest published major release.

| Version          | Supported |
| ---------------- | --------- |
| 1.x              | Yes       |
| Earlier versions | No        |

## Reporting a vulnerability

Use the repository's **Security** tab and select **Report a vulnerability** to open a private GitHub Security Advisory. Do not open a public issue for a suspected vulnerability.

Include, where possible:

- affected KHapiMAN, Node.js and operating-system versions;
- the affected adapter or view: Codex CLI, Claude Code, OpenCode, Aider, API Profiles, Changes, Doctor, or Settings;
- minimal reproduction steps using a fake key, redacted identifiers and disposable local test data;
- expected and observed behavior;
- the security impact and whether the issue is already being exploited;
- redacted logs, diffs or configuration samples.

Never include a working API key, credential-vault export, identifying Profile metadata, or an unredacted `~/.khapiman/backups/` archive. Revoke any credential that may have been exposed before submitting the report.

Maintainers will acknowledge reports as availability permits, coordinate remediation and disclosure in the private advisory, and credit reporters who request attribution. Please allow a reasonable remediation period before public disclosure.

## Scope

In scope are credential disclosure, unsafe configuration writes or rollback, command injection, path traversal, permission bypass, secret-redaction failures and supply-chain issues in the published `khapiman` package.

Reports about a relay provider's service, the upstream coding tools themselves, social engineering, or unsupported clients are outside this project's control. KHapiMAN currently does not support Cursor, Windsurf, Cline or Gemini as managed coding CLIs.
