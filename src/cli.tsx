import { createInterface } from "node:readline/promises";
import process from "node:process";
import crossSpawn from "cross-spawn";
import { Command, Option } from "commander";
import { APP_VERSION, TOOL_LABELS } from "./constants.js";
import { Controller } from "./controller.js";
import { createInstallPlan } from "./installers.js";
import {
  requireTerminalIdentifier,
  terminalLine,
  terminalMultiline,
} from "./terminal.js";
import {
  PROTOCOLS,
  TOOL_IDS,
  type RelayProtocol,
  type ToolId,
} from "./types.js";

interface GlobalOptions {
  ascii?: boolean;
  color: boolean;
}

function symbols(): { ok: string; warn: string; fail: string } {
  const ascii =
    (program.opts<GlobalOptions>().ascii ?? false) || !process.stdout.isTTY;
  return ascii
    ? { ok: "[OK]", warn: "[!]", fail: "[X]" }
    : { ok: "✓", warn: "!", fail: "×" };
}

function validateTools(values: string[]): ToolId[] {
  const tools = [...new Set(values)] as ToolId[];
  const invalid = tools.filter((tool) => !TOOL_IDS.includes(tool));
  if (invalid.length > 0)
    throw new Error(`Unsupported tool(s): ${invalid.join(", ")}`);
  return tools;
}

function validateProtocols(values: string[]): RelayProtocol[] {
  const protocols = [...new Set(values)] as RelayProtocol[];
  const invalid = protocols.filter((protocol) => !PROTOCOLS.includes(protocol));
  if (invalid.length > 0)
    throw new Error(`Unsupported protocol(s): ${invalid.join(", ")}`);
  return protocols;
}

async function readSecretFromStdin(): Promise<string> {
  if (process.stdin.isTTY) {
    throw new Error(
      "For safety, API keys are not accepted as command arguments. Pipe the key to this command or use the interactive UI.",
    );
  }
  let value = "";
  process.stdin.setEncoding("utf8");
  for await (const chunk of process.stdin) value += chunk;
  const secret = value.trim();
  if (!secret) throw new Error("No API key was received on stdin.");
  return secret;
}

async function confirm(
  question: string,
  yes: boolean,
  requiredFlag = "--yes",
): Promise<void> {
  if (yes) return;
  if (!process.stdin.isTTY)
    throw new Error(`Use ${requiredFlag} after reviewing this action.`);
  const readline = createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  try {
    const answer = await readline.question(
      `${terminalLine(question, 800)} [y/N] `,
    );
    if (!/^y(?:es)?$/iu.test(answer.trim())) throw new Error("Cancelled.");
  } finally {
    readline.close();
  }
}

function printChecks(checks: Awaited<ReturnType<Controller["doctor"]>>): void {
  const icon = symbols();
  for (const check of checks) {
    const marker =
      check.status === "pass"
        ? icon.ok
        : check.status === "warn"
          ? icon.warn
          : icon.fail;
    process.stdout.write(
      `${marker} ${terminalLine(check.label, 160)}: ${terminalLine(check.detail, 800)}\n`,
    );
  }
}

function lastInstallerLine(output: string): string | undefined {
  const line = output
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter(Boolean)
    .at(-1);
  return line ? terminalLine(line, 240) : undefined;
}

function controller(): Controller {
  return new Controller();
}

const program = new Command()
  .name("khapiman")
  .enablePositionalOptions()
  .description("Safely configure relay profiles for AI coding CLIs.")
  .version(APP_VERSION)
  .option("--ascii", "use the compact ASCII header")
  .option("--no-color", "disable terminal colors")
  .showSuggestionAfterError()
  .showHelpAfterError();

program.action(async () => {
  const options = program.opts<GlobalOptions>();
  if (!options.color) process.env.NO_COLOR = "1";
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    program.outputHelp();
    return;
  }
  const { runInteractive } = await import("./ui/run.js");
  await runInteractive(controller(), { ascii: options.ascii ?? false });
});

program
  .command("status")
  .description("Show detected tools and active relay bindings.")
  .option("--json", "print machine-readable JSON")
  .action(async ({ json }: { json?: boolean }) => {
    const snapshot = await controller().snapshot();
    if (json) {
      process.stdout.write(`${JSON.stringify(snapshot, null, 2)}\n`);
      return;
    }
    const icon = symbols();
    for (const status of snapshot.statuses) {
      const binding = snapshot.state.bindings[status.id];
      const needsReapply = Boolean(binding && !status.configured);
      const profile = snapshot.state.profiles.find(
        (item) => item.id === binding?.profileId,
      );
      const marker =
        status.installed && status.configured ? icon.ok : icon.warn;
      const detail = needsReapply
        ? `${profile?.name ?? "Saved profile"} (needs re-apply)`
        : status.configured
          ? (profile?.name ?? "Configured outside KHapiMAN")
          : "Not configured";
      process.stdout.write(
        `${marker} ${terminalLine(status.label, 80).padEnd(14)} ${terminalLine(detail, 240)}\n`,
      );
    }
  });

program
  .command("install")
  .description("Detect and install missing supported coding CLIs.")
  .addOption(
    new Option(
      "-t, --tool <tools...>",
      "specific coding CLIs to install",
    ).choices([...TOOL_IDS]),
  )
  .option("--dry-run", "print the fixed installation commands only")
  .option("-y, --yes", "run the reviewed commands without confirmation")
  .action(
    async (options: { tool?: string[]; dryRun?: boolean; yes?: boolean }) => {
      const service = controller();
      const beforeStatuses = await service.detectTools();
      const requested = options.tool
        ? validateTools(options.tool)
        : beforeStatuses
            .filter((status) => !status.installed)
            .map((status) => status.id);
      const installed = new Set(
        beforeStatuses
          .filter((status) => status.installed)
          .map((status) => status.id),
      );
      const pending = requested.filter((tool) => !installed.has(tool));

      for (const tool of requested.filter((item) => installed.has(item))) {
        process.stdout.write(
          `${symbols().ok} ${beforeStatuses.find((status) => status.id === tool)?.label ?? tool} is already installed.\n`,
        );
      }
      if (pending.length === 0) {
        if (requested.length === 0)
          process.stdout.write("All supported coding CLIs are installed.\n");
        return;
      }

      const plans = createInstallPlan(pending);
      process.stdout.write("Installation plan:\n");
      for (const plan of plans) {
        process.stdout.write(
          `  ${beforeStatuses.find((status) => status.id === plan.tool)?.label ?? plan.tool}: ${plan.displayCommand}\n`,
        );
      }
      if (options.dryRun) return;

      await confirm("Run these installation commands?", options.yes ?? false);
      const results = await service.installTools(pending);
      const afterStatuses = await service.detectTools();
      let failed = false;
      for (const result of results) {
        const status = afterStatuses.find(
          (candidate) => candidate.id === result.tool,
        );
        const detected = status?.installed ?? false;
        if (!result.success) failed = true;
        const marker = !result.success
          ? symbols().fail
          : detected
            ? symbols().ok
            : symbols().warn;
        const outputDetail = lastInstallerLine(result.outputSummary);
        const detail = !result.success
          ? `installer failed${result.exitCode === null ? "" : ` with exit code ${result.exitCode}`}${outputDetail ? `: ${outputDetail}` : ""}`
          : detected
            ? `installed${status?.version ? ` (${status.version})` : ""}`
            : "installer completed; open a new terminal and run `khapiman doctor` to refresh PATH";
        process.stdout.write(
          `${marker} ${terminalLine(status?.label ?? result.tool, 80)}: ${terminalLine(detail, 640)}\n`,
        );
      }
      if (failed) process.exitCode = 1;
    },
  );

const profileCommand = program
  .command("profile")
  .description("Manage relay profiles.");

profileCommand
  .command("list")
  .description("List saved relay profiles.")
  .option("--json", "print machine-readable JSON")
  .action(async ({ json }: { json?: boolean }) => {
    const state = await controller().rawState();
    if (json) {
      process.stdout.write(`${JSON.stringify(state.profiles, null, 2)}\n`);
      return;
    }
    if (state.profiles.length === 0) {
      process.stdout.write(
        "No relay profiles. Run `khapiman` to create one.\n",
      );
      return;
    }
    for (const profile of state.profiles) {
      process.stdout.write(
        `${terminalLine(profile.id, 80).padEnd(20)} ${terminalLine(profile.name, 100)}  ${terminalLine(profile.model ?? "(model not selected)", 256)}  ${terminalLine(profile.baseUrl, 300)}\n`,
      );
    }
  });

profileCommand
  .command("add")
  .description("Add a KHaiXAPI profile, reading its API key from stdin.")
  .requiredOption("-n, --name <name>", "profile display name")
  .addOption(
    new Option(
      "-p, --protocol <protocols...>",
      "supported relay protocol",
    ).choices([...PROTOCOLS]),
  )
  .option("-m, --model <model>", "model ID selected from the relay catalog")
  .action(
    async (options: { name: string; protocol?: string[]; model?: string }) => {
      const secret = await readSecretFromStdin();
      const name = requireTerminalIdentifier(options.name, "Profile name", 100);
      const model = options.model
        ? requireTerminalIdentifier(options.model, "Model ID", 256)
        : undefined;
      const profile = await controller().createProfile({
        name,
        protocols: options.protocol
          ? validateProtocols(options.protocol)
          : [...PROTOCOLS],
        secret,
        ...(model ? { model } : {}),
      });
      process.stdout.write(
        `${symbols().ok} Created ${terminalLine(profile.name, 100)} (${terminalLine(profile.id, 80)})${profile.model ? ` with ${terminalLine(profile.model, 256)}` : ""}.\n`,
      );
    },
  );

profileCommand
  .command("remove <profile>")
  .description("Remove an unused relay profile and its credential.")
  .option("-y, --yes", "skip confirmation")
  .action(async (profile: string, options: { yes?: boolean }) => {
    await confirm(
      `Remove relay profile ${terminalLine(profile, 100)}?`,
      options.yes ?? false,
    );
    await controller().deleteProfile(profile);
    process.stdout.write(
      `${symbols().ok} Removed ${terminalLine(profile, 100)}.\n`,
    );
  });

program
  .command("apply <profile>")
  .description("Preview and apply a profile to one or more tools.")
  .addOption(
    new Option("-t, --tool <tools...>", "target tools")
      .choices([...TOOL_IDS])
      .makeOptionMandatory(),
  )
  .option("-m, --model <model>", "exact model ID exposed by the relay")
  .option("-y, --yes", "apply after printing the preview")
  .action(
    async (
      profile: string,
      options: { tool: string[]; model?: string; yes?: boolean },
    ) => {
      const service = controller();
      const model = options.model
        ? requireTerminalIdentifier(options.model, "Model ID", 256)
        : undefined;
      const preview = await service.previewApply(
        profile,
        validateTools(options.tool),
        model,
      );
      process.stdout.write(
        terminalMultiline(preview.diff || "No file changes are required.\n"),
      );
      for (const note of preview.notes)
        process.stdout.write(
          `\n${symbols().warn} ${terminalLine(note, 800)}\n`,
        );
      await confirm("Apply these changes?", options.yes ?? false);
      const result = await service.apply(preview);
      process.stdout.write(
        `${symbols().ok} Applied. Rollback ID: ${terminalLine(result.transactionId, 120)}\n`,
      );
    },
  );

program
  .command("doctor")
  .description("Check runtime, secret storage, tools, and profiles.")
  .option("--json", "print machine-readable JSON")
  .action(async ({ json }: { json?: boolean }) => {
    const checks = await controller().doctor();
    if (json) process.stdout.write(`${JSON.stringify(checks, null, 2)}\n`);
    else printChecks(checks);
    if (checks.some((check) => check.status === "fail")) process.exitCode = 1;
  });

program
  .command("test <profile>")
  .description("Test relay reachability without sending the API key.")
  .option("--json", "print machine-readable JSON")
  .action(async (profile: string, { json }: { json?: boolean }) => {
    const checks = await controller().testConnection(profile);
    if (json) process.stdout.write(`${JSON.stringify(checks, null, 2)}\n`);
    else printChecks(checks);
    if (checks.some((check) => check.status === "fail")) process.exitCode = 1;
  });

program
  .command("rollback [transaction]")
  .description("Restore files from a KHapiMAN transaction.")
  .option("-y, --yes", "skip confirmation")
  .action(
    async (transaction: string | undefined, options: { yes?: boolean }) => {
      const service = controller();
      const target = transaction ?? (await service.latestTransactions())[0]?.id;
      if (!target) throw new Error("No rollback transaction is available.");
      await confirm(
        `Restore transaction ${terminalLine(target, 120)}?`,
        options.yes ?? false,
      );
      await service.rollback(target);
      process.stdout.write(
        `${symbols().ok} Restored ${terminalLine(target, 120)}.\n`,
      );
    },
  );

program
  .command("run <tool> [args...]")
  .description(
    "Run Claude Code, OpenCode or Aider with a managed relay credential.",
  )
  .option(
    "--trust-workspace",
    "trust the current directory (place before <tool> when forwarding options)",
  )
  .allowUnknownOption(true)
  .passThroughOptions()
  .action(
    async (
      toolValue: string,
      args: string[],
      options: { trustWorkspace?: boolean },
    ) => {
      const [tool] = validateTools([toolValue]);
      if (!tool) throw new Error("A supported tool is required.");
      if (tool === "codex") {
        throw new Error(
          "Codex uses its configured credential helper; launch `codex` directly.",
        );
      }
      await confirm(
        `Launch ${TOOL_LABELS[tool]} in ${terminalLine(process.cwd(), 300)} with the relay credential available to that process?`,
        options.trustWorkspace ?? false,
        "--trust-workspace",
      );
      const launch = await controller().runEnvironment(tool);
      const forwardedArgs = args[0] === "--" ? args.slice(1) : args;
      const child = crossSpawn(
        launch.command,
        [...launch.args, ...forwardedArgs],
        {
          stdio: "inherit",
          env: launch.env,
        },
      );
      const code = await new Promise<number>((resolve, reject) => {
        child.once("error", reject);
        child.once("exit", (exitCode, signal) => {
          resolve(exitCode ?? (signal ? 1 : 0));
        });
      });
      process.exitCode = code;
    },
  );

program
  .command("export")
  .description("Export profile metadata without API keys.")
  .option("--json", "print JSON (default)")
  .action(async () => {
    process.stdout.write(await controller().exportRedacted());
  });

program
  .command("secret")
  .description("Internal credential-helper command.")
  .command("get <secret-id>")
  .description("Print one credential for a configured client.")
  .action(async (secretId: string) => {
    const secret = await controller().getSecret(secretId);
    if (!secret) throw new Error("Credential not found.");
    process.stdout.write(secret);
  });

async function main(): Promise<void> {
  await program.parseAsync(process.argv);
}

void main().catch((error: unknown) => {
  const message = terminalLine(
    error instanceof Error ? error.message : String(error),
    1000,
  );
  process.stderr.write(`${symbols().fail} ${message}\n`);
  process.exitCode = message === "Cancelled." ? 0 : 1;
});
