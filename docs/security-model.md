# Security model

KHapiMAN reduces accidental credential exposure and unsafe client-config replacement. It is not a sandbox, a relay verifier, or a defense against an administrator-level process on the same machine.

## Assets and trust boundaries

KHapiMAN handles:

- API keys for the KHaiXAPI relay at `https://api.khaix.net`;
- authenticated model-catalog requests to `https://api.khaix.net/v1/models`;
- fixed relay and protocol metadata;
- user-level configuration for Codex CLI, Claude Code, OpenCode, and Aider;
- raw before-images of files changed by a transaction;
- temporary launch settings and child-process environment variables for Claude Code, OpenCode, and Aider.

You must trust the relay with every prompt, source fragment, and credential an upstream client sends to it. KHapiMAN uses a fixed HTTPS endpoint but cannot independently verify the operator, certificate ownership, API semantics, or retention policy.

## Credential storage

KHapiMAN first probes the optional `@napi-rs/keyring` backend. When available, it stores each Profile key in the operating-system credential vault under the `KHapiMAN` service name. `khapiman doctor` reports the active backend.

If the native module is unavailable or the vault probe fails, KHapiMAN warns and falls back to:

```text
~/.khapiman/secrets.json
```

This fallback is plaintext. KHapiMAN requests mode `0600` and reapplies it on POSIX systems, but filesystem permissions and Windows ACL behavior depend on the host environment. Do not use the fallback on a shared or weakly isolated account. Restore a working vault, rotate affected keys, and recreate Profiles when stronger storage is required.

KHapiMAN never accepts a key as a normal command-line option. The TUI uses a masked field, and scripted entry reads stdin. A sufficiently privileged local process may still inspect terminal input, process memory, the fallback file, or the operating-system vault.

During Profile creation, the key remains in memory while KHapiMAN requests the model catalog and stores the selected model. The response is validated, errors are redacted, and only the model ID is retained as metadata.

## Credential delivery and workspace trust

Codex CLI receives credentials from the `khapiman secret get` helper in user configuration. This keeps the value out of ordinary config, but `khapiman` must remain on `PATH`, and a same-user process that knows a secret ID may be able to invoke the helper.

Claude Code, OpenCode, and Aider must be started with `khapiman run`. Their persistent user configs contain no plaintext relay key. KHapiMAN pins the endpoint for that process using each client's higher-precedence runtime mechanism:

- Claude Code receives command-line settings containing the endpoint and helper reference; conflicting inherited Anthropic credentials, custom headers, endpoints, and provider selectors are removed from its environment.
- OpenCode receives an `OPENCODE_CONFIG_CONTENT` inline override and a Profile-specific key environment variable.
- Aider receives command-line endpoint/model arguments and its key environment variable.

This prevents a project file from silently combining a project-controlled endpoint with a KHapiMAN credential. It does not make an untrusted repository safe. Hooks, plugins, executable configuration, child processes, and forwarded arguments may read inherited variables, invoke accessible helpers, or override runtime behavior. `khapiman run` requires explicit workspace trust; review the repository before granting it.

Environment variables are not written to config files, but child processes and same-user or privileged inspection tools may observe them. Profile exports contain a secret identifier, not the value; treat identifiers and relay URLs as potentially sensitive metadata.

## Client installation boundary

The Clients view and `khapiman install` use a fixed command catalog. KHapiMAN shows the exact command and asks for confirmation unless `--yes` is provided; `--dry-run` starts no installer.

This limits command substitution but does not make third-party software trusted:

- Codex CLI, Claude Code, and OpenCode installation contacts npm and writes to npm's global prefix.
- Aider installation downloads and executes its official operating-system script over HTTPS.
- Packages and remote scripts may change independently of a KHapiMAN release.
- The installer inherits the current user's filesystem, network, and account permissions.
- A timeout terminates the direct child when possible, but descendants may require manual cleanup.
- KHapiMAN does not add `sudo`, bypass permission errors, or repair `PATH`.

Installation is outside the configuration transaction boundary, and rollback cannot uninstall third-party software.

## Preview and writes

Before applying a Profile, KHapiMAN:

1. reads and parses the target config;
2. creates the intended output in memory;
3. displays a unified diff with known Profile secrets redacted;
4. records a hash of the exact before-image;
5. asks for confirmation unless `--yes` was supplied;
6. acquires a global lock and verifies the file still matches the preview;
7. writes through atomic replacement and records a transaction manifest.

Malformed TOML, JSONC, or YAML stops the adapter before a write. If another process changes a file after preview, KHapiMAN refuses to overwrite it. A process able to modify both target files and KHapiMAN state is outside this boundary.

KHapiMAN refuses symbolic-link targets because atomic rename would replace the link itself. Diff redaction is defense in depth, not a general secret scanner: unrelated credentials already present in a config may appear in surrounding context. Protect terminal logs and CI artifacts accordingly.

## Backups and rollback

Transactions are stored under `~/.khapiman/backups/`, or `KHAPIMAN_HOME/backups/`, with private modes requested. Backups contain raw previous file contents. A plaintext token that existed before a change may remain in a backup afterward.

Before rollback, KHapiMAN verifies that each current file still has the recorded after-hash and that each backup has the recorded before-hash. State rollback reverses only bindings changed by that transaction, preserving Profiles and unrelated later bindings. It refuses rollback when the same binding has changed since.

Prepared, failed, and interrupted transactions remain visible and recoverable. Recovery compares current files with recorded images and refuses ambiguous external changes. Journaling reduces partial-write risk after termination or power loss; filesystem and credential-vault operations are not one atomic operating-system transaction.

There is no automatic backup-retention policy. Secure or remove obsolete transaction directories under your workstation policy, but do not modify a transaction you may need to restore.

## Network behavior

KHapiMAN sends no telemetry. Profile creation performs an authenticated `GET` request to the fixed model catalog, rejects redirects, uses an eight-second timeout, and validates the response shape.

`khapiman test <profile>` performs an unauthenticated `HEAD` request to the fixed base URL. It rejects redirects, uses an eight-second timeout, and never attaches the API key. Its result proves reachability only, not authenticated model access.

Client installation is an explicit network exception: npm-based installs contact the configured registry and artifact hosts, while Aider's installer is fetched from its official HTTPS site. Normal model traffic is generated by the upstream client, not KHapiMAN.

## Recommended operation

- Install from the public npm package and prefer releases with provenance linked to `noviantia/KHapiMAN`.
- Preview installation commands and reserve `--yes` for approved automation.
- Use a dedicated, least-privilege relay key for each Profile.
- Run Doctor and a Profile reachability test before applying.
- Read the complete diff and retain the rollback ID.
- Launch Codex directly; use `khapiman run` for Claude Code, OpenCode, and Aider after reviewing workspace trust.
- Keep terminal logs, CI output, `~/.khapiman/`, and home-directory client configs out of source control and support tickets.
- Revoke and rotate credentials after suspected exposure; rollback cannot revoke a key.

## Removal boundary

Uninstalling the npm package does not restore client configuration or erase `~/.khapiman/`. Codex may still reference the removed helper, while other managed bindings depend on `khapiman run`.

Before `npm uninstall --global khapiman`, inspect active bindings and roll back relevant transactions in reverse order. Verify that every client is independent. Keep `~/.khapiman/` until its credentials and raw backups are no longer needed; deleting it removes rollback data irreversibly.

## Incident response

If a key may be exposed:

1. Revoke it at the relay provider immediately.
2. Stop child processes launched with that Profile.
3. Inspect and secure the operating-system vault or fallback file.
4. Inspect transaction backups for older plaintext values.
5. Create a replacement Profile with a new key.
6. Report a KHapiMAN vulnerability privately according to [SECURITY.md](../SECURITY.md).
