# Changelog

All notable changes to KHapiMAN are documented in this file. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [1.0.0] - 2026-08-17

### Added

- New KHapiMAN product identity, public `khapiman` command, and npm package metadata.
- Full-screen terminal workspace with Overview, API Profiles, Clients, Changes, Doctor, and Settings views.
- API Profile management for Codex CLI, Claude Code, OpenCode, and Aider.
- Redacted previews, atomic client configuration writes, conflict detection, transaction history, and verified rollback.
- Operating-system credential-vault support with an explicit permission-restricted plaintext fallback.
- Fixed-command client installers with dry-run previews and confirmation.
- JSON output for status, Profile listing, diagnostics, and reachability checks.
- Cross-platform CI, npm trusted publishing, provenance, and package-brand verification.

### Security

- API keys are accepted only through masked input or stdin and are excluded from Profile exports.
- Claude Code, OpenCode, and Aider receive managed credentials only through trusted child-process launches.
- Package and lockfile checks protect the public release boundary from stale branding and unexpected dependency hosts.

[Unreleased]: https://github.com/noviantia/KHapiMAN/compare/v1.0.0...HEAD
[1.0.0]: https://github.com/noviantia/KHapiMAN/releases/tag/v1.0.0
