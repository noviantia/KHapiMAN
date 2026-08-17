# Compatibility

This document describes the configuration contract implemented by KHapiMAN 1.x. Client vendors may change their formats independently; run `khapiman doctor` after upgrading a client and review every diff before applying it.

## Runtime and TUI

KHapiMAN requires Node.js 22 or newer and npm. Installation is the same on Windows, macOS, and Linux:

```shell
npm install --global khapiman
khapiman
```

The full-screen workspace contains Overview, API Profiles, Clients, Changes, Doctor, and Settings views. It detects clients from the current process `PATH`; opening a new terminal may be required after installing a client.

## Supported clients

| Client      | ID         | Required Profile protocol | Default user configuration                     | Model required when applying |
| ----------- | ---------- | ------------------------- | ---------------------------------------------- | ---------------------------- |
| Codex CLI   | `codex`    | `openai-responses`        | `~/.codex/config.toml`                         | Yes                          |
| Claude Code | `claude`   | `anthropic-messages`      | `~/.claude/settings.json`                      | No                           |
| OpenCode    | `opencode` | `openai-chat`             | `~/.config/opencode/opencode.jsonc` or `.json` | Yes                          |
| Aider       | `aider`    | `openai-chat`             | `~/.aider.conf.yml`                            | Yes                          |

`~` means the current user's home directory on every supported operating system. KHapiMAN can configure a client whose executable is not on `PATH`; Doctor reports that state as a warning.

Cursor, Windsurf, Cline, and Gemini are intentionally unsupported. KHapiMAN does not discover or edit their settings.

## Client installation

The Clients view and `khapiman install` use a fixed command catalog. They show the complete command and require confirmation before execution. Existing clients are not offered as missing.

```shell
khapiman install --dry-run
khapiman install --tool codex claude opencode aider --dry-run
khapiman install --tool codex opencode --yes
```

| Client ID  | Platform      | Fixed command                                                                       |
| ---------- | ------------- | ----------------------------------------------------------------------------------- |
| `codex`    | All           | `npm install --global @openai/codex`                                                |
| `claude`   | All           | `npm install --global @anthropic-ai/claude-code`                                    |
| `opencode` | All           | `npm install --global opencode-ai`                                                  |
| `aider`    | macOS / Linux | `curl -LsSf https://aider.chat/install.sh \| sh`                                    |
| `aider`    | Windows       | `powershell -ExecutionPolicy ByPass -c "irm https://aider.chat/install.ps1 \| iex"` |

`--dry-run` executes nothing. KHapiMAN never adds `sudo`, requests elevation, changes package-manager permissions, or repairs `PATH`. The commands contact third-party registries or installer sites and run with the current user's permissions.

Client installation is outside KHapiMAN configuration transactions. `khapiman rollback` cannot uninstall a client; use that client's official uninstall process.

## API Profile contract

New Profiles use the bundled KHaiXAPI endpoint:

```text
https://api.khaix.net
```

The endpoint is not a user-editable Profile field. After key entry, KHapiMAN sends an authenticated `GET` request to `https://api.khaix.net/v1/models`, validates the response, and stores the selected model ID as non-secret metadata. The API key is stored separately by the configured credential backend and is never written to the state JSON.

Network, timeout, HTTP, and malformed-response errors return to Profile entry without echoing the key. Older valid state remains readable, but a binding with a non-bundled endpoint is marked for re-apply and cannot be launched through `khapiman run` until reviewed and updated.

Protocols describe real API shapes and are not interchangeable labels:

| Profile value        | API shape                              | Clients         |
| -------------------- | -------------------------------------- | --------------- |
| `openai-responses`   | OpenAI Responses API                   | Codex CLI       |
| `openai-chat`        | OpenAI-compatible Chat Completions API | OpenCode, Aider |
| `anthropic-messages` | Anthropic Messages API                 | Claude Code     |

One Profile may declare multiple protocols. KHapiMAN rejects incompatible Profile/client assignments before creating a change. The TUI supplies the bundled capabilities and filters Profiles for the selected client.

## Codex CLI

KHapiMAN preserves unrelated TOML where possible, sets the root `model` and `model_provider`, and maintains a marked `[model_providers.khapiman]` block with `wire_api = "responses"`.

The API key is resolved at runtime through:

```text
khapiman secret get <secret-id>
```

An existing `[model_providers.khapiman]` table without KHapiMAN management markers is treated as user-owned and is never overwritten. The `CODEX_HOME` environment variable overrides the directory for the KHapiMAN process; otherwise the path is `~/.codex/config.toml`.

Launch Codex directly after applying a Profile:

```shell
codex
```

## Claude Code

KHapiMAN edits `~/.claude/settings.json` as JSONC-compatible content. It removes persistent relay endpoints, plaintext Anthropic credentials, and persistent credential helpers, then records only a non-secret Profile marker. Unrelated settings and comments are retained where JSONC edits permit; malformed content stops the operation without writing.

For each managed launch, KHapiMAN supplies command-line settings containing the fixed endpoint and credential-helper reference. It also removes conflicting inherited Anthropic credentials, custom headers, endpoints, and provider selectors from the child environment.

```shell
khapiman run --trust-workspace claude -- [claude arguments]
```

## OpenCode

KHapiMAN uses an existing `~/.config/opencode/opencode.jsonc`, then an existing `opencode.json`, and otherwise creates `opencode.jsonc`. It adds a managed OpenAI-compatible provider named `khapiman` using `@ai-sdk/openai-compatible` and selects `khapiman/<model>`.

The file contains the name of a Profile-specific environment variable, not its value. A managed launch provides that variable and an `OPENCODE_CONFIG_CONTENT` override for the selected endpoint. Malformed JSON or JSONC stops the operation without writing.

```shell
khapiman run --trust-workspace opencode -- [opencode arguments]
```

## Aider

KHapiMAN removes persistent `openai-api-base`, `model`, and `openai-api-key` entries from `~/.aider.conf.yml`, then adds a non-secret Profile marker comment. A managed launch supplies endpoint/model arguments and the Profile-specific key environment variable. Malformed YAML stops the operation without writing.

```shell
khapiman run --trust-workspace aider -- [aider arguments]
```

For Claude Code, OpenCode, and Aider, the current repository remains a trust boundary. Project hooks, plugins, executable configuration, child processes, and forwarded arguments may inspect or override runtime behavior. Interactive launches request confirmation; automation must explicitly provide `--trust-workspace`.

## Multi-client apply

One `apply` invocation uses one model value for all selected clients that require a model. When protocols expose different model IDs, apply them separately:

```shell
khapiman apply primary --tool codex --model responses-model
khapiman apply primary --tool opencode aider --model chat-model
khapiman apply primary --tool claude
```

Every apply includes KHapiMAN binding state in the same transaction as the selected client configuration changes.

## Environment variables

| Variable        | Effect                                                                    |
| --------------- | ------------------------------------------------------------------------- |
| `KHAPIMAN_HOME` | Overrides KHapiMAN state, credential fallback, lock, and backup directory |
| `CODEX_HOME`    | Overrides the Codex configuration directory while KHapiMAN runs           |
| `NO_COLOR`      | Disables color for components that honor the standard variable            |

`KHAPIMAN_HOME` does not relocate client configuration files.
