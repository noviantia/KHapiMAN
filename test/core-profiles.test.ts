import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  ProfileInUseError,
  ProfileManager,
  ProfileValidationError,
  normalizeBaseUrl,
} from "../src/core/profiles.js";
import { resolveRuntimePaths } from "../src/paths.js";
import { loadState, saveState } from "../src/state/index.js";

const temporaryRoots: string[] = [];

async function setup() {
  const root = await mkdtemp(join(tmpdir(), "khapiman-profile-"));
  temporaryRoots.push(root);
  const paths = resolveRuntimePaths({ homeDir: root, env: {} });
  const manager = new ProfileManager(paths, {
    now: () => new Date("2026-08-14T04:00:00.000Z"),
    randomId: () => "00000000-0000-4000-8000-000000000001",
  });
  return { paths, manager };
}

afterEach(async () => {
  await Promise.all(
    temporaryRoots
      .splice(0)
      .map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("profile management", () => {
  it("normalizes safe URLs and permits HTTP only on loopback", () => {
    expect(normalizeBaseUrl(" HTTPS://Relay.Example.com:443/v1/// ")).toBe(
      "https://relay.example.com/v1",
    );
    expect(normalizeBaseUrl("http://127.0.0.1:8080/v1/")).toBe(
      "http://127.0.0.1:8080/v1",
    );
    expect(normalizeBaseUrl("http://localhost.:8080/")).toBe(
      "http://localhost.:8080",
    );
    expect(normalizeBaseUrl("http://[::1]:8080/")).toBe("http://[::1]:8080");
    expect(() => normalizeBaseUrl("http://relay.example.com")).toThrow(
      ProfileValidationError,
    );
    expect(() => normalizeBaseUrl("https://user:key@example.com")).toThrow(
      ProfileValidationError,
    );
  });

  it("creates, updates and deletes profiles without persisting a key", async () => {
    const { paths, manager } = await setup();
    const created = await manager.create({
      name: "Company Relay",
      baseUrl: "https://relay.example.com/v1/",
      protocols: ["openai-responses", "openai-responses"],
      model: "  gpt-5-codex  ",
    });
    expect(created).toMatchObject({
      id: "company-relay",
      baseUrl: "https://relay.example.com/v1",
      protocols: ["openai-responses"],
      model: "gpt-5-codex",
      secretId: "profile-00000000-0000-4000-8000-000000000001",
    });
    expect(await readFile(paths.stateFile, "utf8")).not.toContain(
      "api-key-value",
    );

    const state = await loadState(paths);
    state.bindings.codex = {
      tool: "codex",
      profileId: created.id,
      appliedAt: "2026-08-14T04:00:00.000Z",
    };
    await saveState(state, paths);

    expect(
      await manager.update(created.id, {
        baseUrl: "https://new.example.com/",
        model: "gpt-5-mini",
      }),
    ).toMatchObject({
      baseUrl: "https://new.example.com",
      model: "gpt-5-mini",
    });
    await expect(manager.delete(created.id)).rejects.toBeInstanceOf(
      ProfileInUseError,
    );
    expect((await loadState(paths)).profiles).toHaveLength(1);

    const inactiveState = await loadState(paths);
    delete inactiveState.bindings.codex;
    await saveState(inactiveState, paths);
    await manager.delete(created.id);
    expect(await loadState(paths)).toEqual({
      schemaVersion: 1,
      profiles: [],
      bindings: {},
    });
  });

  it("rejects secret-shaped extra input instead of writing it to state", async () => {
    const { manager } = await setup();
    await expect(
      manager.create({
        name: "Unsafe",
        baseUrl: "https://relay.example.com",
        protocols: ["openai-responses"],
        apiKey: "api-key-value",
      } as never),
    ).rejects.toBeInstanceOf(ProfileValidationError);
  });

  it("rejects terminal control characters in persisted display fields", async () => {
    const { manager } = await setup();
    await expect(
      manager.create({
        name: "Unsafe\u001b[31m profile",
        baseUrl: "https://relay.example.com",
        protocols: ["openai-chat"],
        model: "model\nforged-line",
      }),
    ).rejects.toBeInstanceOf(ProfileValidationError);
  });
});
