import {
  mkdtemp,
  readFile,
  readdir,
  rm,
  stat,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { RELAY_BASE_URL } from "../src/constants.js";
import { Controller } from "../src/controller.js";
import { atomicWriteFile, UnsafeFileTypeError } from "../src/core/fs.js";
import { resolveRuntimePaths } from "../src/paths.js";
import {
  StateValidationError,
  loadState,
  saveState,
} from "../src/state/index.js";

const temporaryRoots: string[] = [];

async function temporaryRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "khapiman-core-"));
  temporaryRoots.push(root);
  return root;
}

afterEach(async () => {
  await Promise.all(
    temporaryRoots
      .splice(0)
      .map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("runtime paths and state", () => {
  it.runIf(process.platform !== "win32")(
    "refuses to replace a symbolic-link target during an atomic write",
    async () => {
      const root = await temporaryRoot();
      const target = join(root, "actual.json");
      const linked = join(root, "linked.json");
      await writeFile(target, "original\n");
      await symlink(target, linked, "file");

      await expect(
        atomicWriteFile(linked, "replacement\n"),
      ).rejects.toBeInstanceOf(UnsafeFileTypeError);
      expect(await readFile(target, "utf8")).toBe("original\n");
    },
  );

  it("resolves the default data directory and KHAPIMAN_HOME override", async () => {
    const root = await temporaryRoot();
    const defaults = resolveRuntimePaths({ homeDir: root, env: {} });
    expect(defaults.home).toBe(resolve(root));
    expect(defaults.dataDir).toBe(join(resolve(root), ".khapiman"));
    expect(defaults.stateFile).toBe(join(defaults.dataDir, "state.json"));

    const overridden = resolveRuntimePaths({
      homeDir: root,
      env: { KHAPIMAN_HOME: "~/relay-data" },
    });
    expect(overridden.dataDir).toBe(join(resolve(root), "relay-data"));
  });

  it("returns a fresh empty state and atomically persists validated state", async () => {
    const root = await temporaryRoot();
    const paths = resolveRuntimePaths({ homeDir: root, env: {} });
    const first = await loadState(paths);
    first.profiles.push({
      id: "company",
      name: "Company",
      baseUrl: "https://relay.example.com",
      protocols: ["openai-responses"],
      secretId: "profile-company",
      createdAt: "2026-08-14T04:00:00.000Z",
      updatedAt: "2026-08-14T04:00:00.000Z",
    });

    expect((await loadState(paths)).profiles).toEqual([]);
    await saveState(first, paths);
    expect((await loadState(paths)).profiles).toEqual(first.profiles);
    expect((await new Controller(paths).rawState()).profiles[0]?.baseUrl).toBe(
      RELAY_BASE_URL,
    );
    expect(await readdir(paths.dataDir)).toEqual(["state.json"]);

    if (process.platform !== "win32") {
      expect((await stat(paths.stateFile)).mode & 0o777).toBe(0o600);
    }
  });

  it("rejects malformed state and unknown fields such as raw keys", async () => {
    const root = await temporaryRoot();
    const paths = resolveRuntimePaths({ homeDir: root, env: {} });
    await saveState({ schemaVersion: 1, profiles: [], bindings: {} }, paths);

    const value = JSON.parse(await readFile(paths.stateFile, "utf8")) as Record<
      string,
      unknown
    >;
    value.apiKey = "must-not-be-accepted";
    await writeFile(paths.stateFile, JSON.stringify(value));

    await expect(loadState(paths)).rejects.toBeInstanceOf(StateValidationError);
  });

  it("rejects dangling or mismatched tool bindings", async () => {
    const root = await temporaryRoot();
    const paths = resolveRuntimePaths({ homeDir: root, env: {} });
    await expect(
      saveState(
        {
          schemaVersion: 1,
          profiles: [],
          bindings: {
            codex: {
              tool: "claude",
              profileId: "missing",
              appliedAt: "2026-08-14T04:00:00.000Z",
            },
          },
        },
        paths,
      ),
    ).rejects.toBeInstanceOf(StateValidationError);
  });
});
