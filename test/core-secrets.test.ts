import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { LEGACY_SECRET_SERVICE, SECRET_SERVICE } from "../src/constants.js";
import { getSecretsFile, resolveRuntimePaths } from "../src/paths.js";
import {
  createSecretStore,
  type KeyringModuleLike,
} from "../src/secrets/index.js";

const temporaryRoots: string[] = [];

async function pathsForTest() {
  const root = await mkdtemp(join(tmpdir(), "khapiman-secrets-"));
  temporaryRoots.push(root);
  return resolveRuntimePaths({ homeDir: root, env: {} });
}

afterEach(async () => {
  await Promise.all(
    temporaryRoots
      .splice(0)
      .map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("secret storage", () => {
  it("uses a permission-0600 JSON fallback with an explicit warning", async () => {
    const paths = await pathsForTest();
    const store = await createSecretStore({ paths, keyringModule: null });
    expect(store.status).toMatchObject({ backend: "file", secure: false });
    expect(store.status.warning).toContain("plaintext");

    await store.set("profile-company", "api-key-value");
    expect(await store.get("profile-company")).toBe("api-key-value");
    const persisted = await readFile(getSecretsFile(paths), "utf8");
    expect(persisted).toContain("api-key-value");
    if (process.platform !== "win32") {
      expect((await stat(getSecretsFile(paths))).mode & 0o777).toBe(0o600);
    }
    expect(await store.delete("profile-company")).toBe(true);
    expect(await store.get("profile-company")).toBeUndefined();
  });

  it("uses Entry(KHapiMAN, secretId) when the system keyring works", async () => {
    const paths = await pathsForTest();
    const values = new Map<string, string>();
    const services: string[] = [];
    class Entry {
      constructor(
        service: string,
        private readonly username: string,
      ) {
        services.push(service);
      }
      setPassword(value: string) {
        values.set(this.username, value);
      }
      getPassword() {
        return values.get(this.username) ?? null;
      }
      deleteCredential() {
        return values.delete(this.username);
      }
    }

    const store = await createSecretStore({
      paths,
      keyringModule: { Entry } satisfies KeyringModuleLike,
    });
    expect(store.status).toEqual({ backend: "keyring", secure: true });
    await store.set("profile-company", "api-key-value");
    expect(await store.get("profile-company")).toBe("api-key-value");
    expect(services.every((service) => service === SECRET_SERVICE)).toBe(true);
  });

  it("migrates a credential from the legacy keyring service on first read", async () => {
    const paths = await pathsForTest();
    const values = new Map<string, string>();
    const key = (service: string, username: string) =>
      `${service}\0${username}`;
    class Entry {
      constructor(
        private readonly service: string,
        private readonly username: string,
      ) {}
      setPassword(value: string) {
        values.set(key(this.service, this.username), value);
      }
      getPassword() {
        return values.get(key(this.service, this.username)) ?? null;
      }
      deleteCredential() {
        return values.delete(key(this.service, this.username));
      }
    }

    const store = await createSecretStore({
      paths,
      keyringModule: { Entry } satisfies KeyringModuleLike,
    });
    values.set(key(LEGACY_SECRET_SERVICE, "profile-legacy"), "legacy-key");

    expect(await store.get("profile-legacy")).toBe("legacy-key");
    expect(values.get(key(SECRET_SERVICE, "profile-legacy"))).toBe(
      "legacy-key",
    );
    expect(values.has(key(LEGACY_SECRET_SERVICE, "profile-legacy"))).toBe(
      false,
    );
  });

  it("keeps successful current-service operations when legacy cleanup fails", async () => {
    const paths = await pathsForTest();
    const values = new Map<string, string>();
    const key = (service: string, username: string) =>
      `${service}\0${username}`;
    class Entry {
      constructor(
        private readonly service: string,
        private readonly username: string,
      ) {}
      setPassword(value: string) {
        values.set(key(this.service, this.username), value);
      }
      getPassword() {
        return values.get(key(this.service, this.username)) ?? null;
      }
      deleteCredential() {
        if (this.service === LEGACY_SECRET_SERVICE) {
          throw new Error("legacy backend unavailable");
        }
        return values.delete(key(this.service, this.username));
      }
    }

    const store = await createSecretStore({
      paths,
      keyringModule: { Entry } satisfies KeyringModuleLike,
    });
    values.set(key(LEGACY_SECRET_SERVICE, "profile-legacy"), "legacy-key");
    expect(await store.get("profile-legacy")).toBe("legacy-key");
    expect(await store.delete("profile-legacy")).toBe(true);
  });
});
