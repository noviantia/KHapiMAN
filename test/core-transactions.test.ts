import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  FileChangedError,
  TransactionEngine,
} from "../src/core/transactions.js";
import { acquireFileLock, FileLockError } from "../src/core/lock.js";
import { resolveRuntimePaths } from "../src/paths.js";
import { loadState, saveState } from "../src/state/index.js";
import type { AppState, RelayProfile } from "../src/types.js";

const temporaryRoots: string[] = [];

async function setup() {
  const root = await mkdtemp(join(tmpdir(), "khapiman-transaction-"));
  temporaryRoots.push(root);
  const paths = resolveRuntimePaths({ homeDir: root, env: {} });
  return {
    root,
    paths,
    engine: new TransactionEngine(paths),
  };
}

afterEach(async () => {
  await Promise.all(
    temporaryRoots
      .splice(0)
      .map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("file transactions", () => {
  it("produces redacted previews without hiding structural changes", async () => {
    const { root, engine } = await setup();
    const path = join(root, "config.json");
    const [preview] = engine.preview(
      [
        {
          path,
          before:
            '{"api_key":"old-secret","authorization":"Basic dXNlcjpvbGQ="}\n',
          after:
            '{"api_key":"new-secret","authorization":"Basic dXNlcjpuZXc=","model":"gpt"}\n',
          description: "Configure relay",
        },
      ],
      { secrets: ["old-secret", "new-secret"] },
    );
    expect(preview?.changed).toBe(true);
    expect(preview?.diff).toContain("model");
    expect(preview?.diff).toContain("[REDACTED]");
    expect(preview?.diff).not.toContain("old-secret");
    expect(preview?.diff).not.toContain("new-secret");
    expect(preview?.diff).not.toContain("dXNlcjpvbGQ");
    expect(preview?.diff).not.toContain("dXNlcjpuZXc");
  });

  it("backs up, hashes, applies, lists and rolls back multiple files", async () => {
    const { root, engine } = await setup();
    const existing = join(root, "existing.toml");
    const created = join(root, "nested", "new.env");
    await writeFile(existing, "before\n");

    const manifest = await engine.apply([
      {
        path: existing,
        before: "before\n",
        after: "after\n",
        description: "Update existing",
      },
      {
        path: created,
        before: null,
        after: "NEW=value\n",
        mode: 0o600,
        description: "Create environment",
      },
    ]);
    expect(await readFile(existing, "utf8")).toBe("after\n");
    expect(await readFile(created, "utf8")).toBe("NEW=value\n");
    expect(manifest.files).toHaveLength(2);
    expect(manifest.files[0]?.beforeHash).toMatch(/^[a-f0-9]{64}$/);
    expect((await engine.list()).map((item) => item.id)).toContain(manifest.id);

    await engine.rollback(manifest.id);
    expect(await readFile(existing, "utf8")).toBe("before\n");
    await expect(readFile(created, "utf8")).rejects.toMatchObject({
      code: "ENOENT",
    });
    expect((await engine.list()).map((item) => item.id)).not.toContain(
      manifest.id,
    );
  });

  it("refuses apply and rollback when a target changed outside KHapiman", async () => {
    const { root, engine } = await setup();
    const path = join(root, "config.toml");
    await writeFile(path, "original\n");
    await expect(
      engine.apply([
        {
          path,
          before: "stale preview\n",
          after: "managed\n",
          description: "Stale apply",
        },
      ]),
    ).rejects.toBeInstanceOf(FileChangedError);

    const manifest = await engine.apply([
      {
        path,
        before: "original\n",
        after: "managed\n",
        description: "Managed apply",
      },
    ]);
    await writeFile(path, "external edit\n");
    await expect(engine.rollback(manifest.id)).rejects.toBeInstanceOf(
      FileChangedError,
    );
    expect(await readFile(path, "utf8")).toBe("external edit\n");
  });

  it("serializes writes behind the global application lock", async () => {
    const { root, paths, engine } = await setup();
    const lock = await acquireFileLock(paths.lockFile);
    try {
      await expect(
        engine.apply([
          {
            path: join(root, "config.toml"),
            before: null,
            after: "managed\n",
            description: "Locked apply",
          },
        ]),
      ).rejects.toBeInstanceOf(FileLockError);
    } finally {
      await lock.release();
    }
  });

  it("serializes concurrent reclamation of an abandoned lock", async () => {
    const { paths } = await setup();
    await mkdir(paths.dataDir, { recursive: true });
    await writeFile(
      paths.lockFile,
      `${JSON.stringify({
        pid: 2_147_483_647,
        acquiredAt: "2026-08-14T04:00:00.000Z",
        token: "abandoned-lock",
      })}\n`,
    );

    const attempts = await Promise.allSettled([
      acquireFileLock(paths.lockFile),
      acquireFileLock(paths.lockFile),
    ]);
    const acquired = attempts.filter(
      (
        attempt,
      ): attempt is PromiseFulfilledResult<
        Awaited<ReturnType<typeof acquireFileLock>>
      > => attempt.status === "fulfilled",
    );
    const rejected = attempts.filter(
      (attempt) => attempt.status === "rejected",
    );
    expect(acquired).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect(rejected[0]).toMatchObject({ reason: expect.any(FileLockError) });
    await expect(acquireFileLock(paths.lockFile)).rejects.toBeInstanceOf(
      FileLockError,
    );
    await acquired[0]?.value.release();
  });

  it("recovers an abandoned reclamation guard", async () => {
    const { paths } = await setup();
    await mkdir(paths.dataDir, { recursive: true });
    const abandoned = `${JSON.stringify({
      pid: 2_147_483_647,
      acquiredAt: "2026-08-14T04:00:00.000Z",
      token: "abandoned-lock",
    })}\n`;
    await writeFile(paths.lockFile, abandoned);
    await writeFile(`${paths.lockFile}.reclaim`, abandoned);

    const lock = await acquireFileLock(paths.lockFile);
    await lock.release();
    const nextLock = await acquireFileLock(paths.lockFile);
    await nextLock.release();
  });

  it("lists and recovers an interrupted partially applied transaction", async () => {
    const { root, paths, engine } = await setup();
    const first = join(root, "first.toml");
    const second = join(root, "second.toml");
    await writeFile(first, "first-before\n");
    await writeFile(second, "second-before\n");
    const manifest = await engine.apply([
      {
        path: first,
        before: "first-before\n",
        after: "first-after\n",
        description: "Update first",
      },
      {
        path: second,
        before: "second-before\n",
        after: "second-after\n",
        description: "Update second",
      },
    ]);

    await writeFile(second, "second-before\n");
    const manifestPath = join(paths.backupDir, manifest.id, "manifest.json");
    const stored = JSON.parse(await readFile(manifestPath, "utf8")) as Record<
      string,
      unknown
    >;
    stored.status = "prepared";
    await writeFile(manifestPath, `${JSON.stringify(stored, null, 2)}\n`);

    expect(await engine.list()).toContainEqual(
      expect.objectContaining({ id: manifest.id, status: "prepared" }),
    );
    await engine.recover(manifest.id);
    expect(await readFile(first, "utf8")).toBe("first-before\n");
    expect(await readFile(second, "utf8")).toBe("second-before\n");
    expect((await engine.list()).map((item) => item.id)).not.toContain(
      manifest.id,
    );
  });

  it("resumes an interrupted rollback", async () => {
    const { root, paths, engine } = await setup();
    const first = join(root, "first.toml");
    const second = join(root, "second.toml");
    await writeFile(first, "first-before\n");
    await writeFile(second, "second-before\n");
    const manifest = await engine.apply([
      {
        path: first,
        before: "first-before\n",
        after: "first-after\n",
        description: "Update first",
      },
      {
        path: second,
        before: "second-before\n",
        after: "second-after\n",
        description: "Update second",
      },
    ]);
    await writeFile(first, "first-before\n");
    const manifestPath = join(paths.backupDir, manifest.id, "manifest.json");
    const stored = JSON.parse(await readFile(manifestPath, "utf8")) as Record<
      string,
      unknown
    >;
    stored.status = "rolling-back";
    await writeFile(manifestPath, `${JSON.stringify(stored, null, 2)}\n`);

    await engine.recover(manifest.id);
    expect(await readFile(first, "utf8")).toBe("first-before\n");
    expect(await readFile(second, "utf8")).toBe("second-before\n");
  });

  it("rolls back only affected bindings while preserving later state changes", async () => {
    const { root, paths, engine } = await setup();
    const profile: RelayProfile = {
      id: "primary",
      name: "Primary",
      baseUrl: "https://relay.example.com",
      protocols: ["openai-responses"],
      secretId: "profile-primary",
      createdAt: "2026-08-14T04:00:00.000Z",
      updatedAt: "2026-08-14T04:00:00.000Z",
    };
    const beforeState: AppState = {
      schemaVersion: 1,
      profiles: [profile],
      bindings: {},
    };
    await saveState(beforeState, paths);
    const beforeText = await readFile(paths.stateFile, "utf8");
    const afterState = structuredClone(beforeState);
    afterState.bindings.codex = {
      tool: "codex",
      profileId: profile.id,
      appliedAt: "2026-08-14T04:01:00.000Z",
    };
    const configPath = join(root, "codex.toml");
    await writeFile(configPath, "before\n");
    const manifest = await engine.apply([
      {
        path: configPath,
        before: "before\n",
        after: "after\n",
        description: "Configure Codex",
      },
      {
        path: paths.stateFile,
        before: beforeText,
        after: `${JSON.stringify(afterState, null, 2)}\n`,
        description: "Record Codex binding",
      },
    ]);

    const later = await loadState(paths);
    later.profiles.push({
      ...profile,
      id: "later",
      name: "Later",
      secretId: "profile-later",
      createdAt: "2026-08-14T04:02:00.000Z",
      updatedAt: "2026-08-14T04:02:00.000Z",
    });
    later.bindings.claude = {
      tool: "claude",
      profileId: "later",
      appliedAt: "2026-08-14T04:02:00.000Z",
    };
    await saveState(later, paths);

    await engine.rollback(manifest.id);
    expect(await readFile(configPath, "utf8")).toBe("before\n");
    const restored = await loadState(paths);
    expect(restored.profiles.map((item) => item.id)).toEqual([
      "primary",
      "later",
    ]);
    expect(restored.bindings.codex).toBeUndefined();
    expect(restored.bindings.claude?.profileId).toBe("later");
  });

  it("refuses an old rollback after its binding was replaced", async () => {
    const { root, paths, engine } = await setup();
    const makeProfile = (id: string): RelayProfile => ({
      id,
      name: id,
      baseUrl: "https://relay.example.com",
      protocols: ["openai-responses"],
      secretId: `profile-${id}`,
      createdAt: "2026-08-14T04:00:00.000Z",
      updatedAt: "2026-08-14T04:00:00.000Z",
    });
    const beforeState: AppState = {
      schemaVersion: 1,
      profiles: [makeProfile("first"), makeProfile("second")],
      bindings: {},
    };
    await saveState(beforeState, paths);
    const beforeText = await readFile(paths.stateFile, "utf8");
    const afterState = structuredClone(beforeState);
    afterState.bindings.codex = {
      tool: "codex",
      profileId: "first",
      appliedAt: "2026-08-14T04:01:00.000Z",
    };
    const configPath = join(root, "codex.toml");
    await writeFile(configPath, "before\n");
    const manifest = await engine.apply([
      {
        path: configPath,
        before: "before\n",
        after: "after\n",
        description: "Configure Codex",
      },
      {
        path: paths.stateFile,
        before: beforeText,
        after: `${JSON.stringify(afterState, null, 2)}\n`,
        description: "Record Codex binding",
      },
    ]);
    const replaced = await loadState(paths);
    replaced.bindings.codex = {
      tool: "codex",
      profileId: "second",
      appliedAt: "2026-08-14T04:02:00.000Z",
    };
    await saveState(replaced, paths);

    await expect(engine.rollback(manifest.id)).rejects.toBeInstanceOf(
      FileChangedError,
    );
    expect(await readFile(configPath, "utf8")).toBe("after\n");
    expect((await loadState(paths)).bindings.codex?.profileId).toBe("second");
  });
});
