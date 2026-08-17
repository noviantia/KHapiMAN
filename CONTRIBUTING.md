# Contributing to KHapiMAN

KHapiMAN is deliberately narrow: it manages relay profiles for Codex CLI, Claude Code, OpenCode and Aider on Windows, macOS and Linux. Cursor, Windsurf, Cline and Gemini are not supported. Open an issue before starting a new adapter or changing a persisted configuration contract.

## Development setup

Prerequisites:

- Node.js 22 or 24;
- npm matching the checked-in `package-lock.json` closely enough to honor it;
- Git;
- no real API credentials in the development environment.

Install and verify:

```shell
npm ci
npm run check
```

Useful focused commands:

```shell
npm run typecheck
npm run lint
npm test
npm run build
npm run format:check
```

Run the source CLI with an isolated data directory. The examples below prevent test profiles and transactions from mixing with normal KHapiMAN state.

macOS / Linux:

```shell
KHAPIMAN_HOME="$(mktemp -d)" npm run dev
```

PowerShell:

```powershell
$env:KHAPIMAN_HOME = Join-Path $env:TEMP "khapiman-dev-$PID"
npm run dev
```

## Change expectations

- Preserve unrelated TOML, JSONC and YAML content and comments whenever the parser supports it.
- Keep preview, apply and rollback behavior transactional. A file changed after preview must not be silently overwritten.
- Never accept an API Key as a normal CLI argument, print it, include it in snapshots, or commit it in a fixture.
- Use obvious fake values such as `khp_test_not_a_secret` in tests, and keep test homes inside temporary directories.
- Cover Windows path behavior as well as POSIX behavior when touching paths, process launching or permissions.
- Add or update tests for adapter rendering, state migrations, secret backends and rollback failure modes as applicable.
- Keep user-facing brand text as `KHapiMAN` and the executable/package name as `khapiman`.
- Keep retired product names and their protocol identifiers out of source, documentation, and npm package contents; run `npm run check:package-brand` before release.

## Pull requests

1. Keep a change focused and explain the user-visible behavior.
2. Add a changelog entry under `Unreleased` for behavior users need to know about.
3. Run `npm run check` and `npm run format:check`.
4. Confirm tests use no real home-directory configuration or live keys.
5. Complete the pull request checklist and include redacted terminal output when it helps review.

Do not commit generated credentials, local `.khapiman` data, editor state, coverage output or packed `.tgz` files.

## Reporting security issues

Do not disclose a suspected vulnerability in an issue or pull request. Follow [SECURITY.md](SECURITY.md).

## Releases

Maintainers publish through GitHub Actions and npm trusted publishing. The full process and required OIDC setup are documented in [docs/publishing.md](docs/publishing.md).
