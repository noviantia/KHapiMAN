import { randomUUID } from "node:crypto";
import { isIP } from "node:net";

import { z } from "zod";

import { isTerminalIdentifier } from "../terminal.js";
import { PROTOCOLS } from "../types.js";
import type {
  AppState,
  RelayProfile,
  RelayProtocol,
  RuntimePaths,
} from "../types.js";
import { resolveRuntimePaths } from "../paths.js";
import { loadState, saveState } from "../state/store.js";
import { withGlobalLock } from "./lock.js";

export interface CreateProfileInput {
  id?: string;
  name: string;
  baseUrl: string;
  protocols: RelayProtocol[];
  model?: string;
  secretId?: string;
}

export interface UpdateProfileInput {
  name?: string;
  baseUrl?: string;
  protocols?: RelayProtocol[];
  model?: string;
  secretId?: string;
}

export interface ProfileManagerOptions {
  now?: () => Date;
  randomId?: () => string;
}

const idSchema = z
  .string()
  .trim()
  .min(1)
  .max(128)
  .regex(/^[a-zA-Z0-9][a-zA-Z0-9._:-]*$/);

const protocolsSchema = z
  .array(z.enum(PROTOCOLS))
  .min(1)
  .transform((values) => [...new Set(values)]);

const profileNameSchema = z
  .string()
  .trim()
  .min(1)
  .max(100)
  .refine((value) => isTerminalIdentifier(value, 100), {
    message: "Profile name must be a single-line printable value",
  });

const modelSchema = z
  .string()
  .trim()
  .min(1)
  .max(256)
  .refine((value) => isTerminalIdentifier(value, 256), {
    message: "Model ID must be a single-line printable value",
  });

const createProfileSchema = z.strictObject({
  id: idSchema.optional(),
  name: profileNameSchema,
  baseUrl: z.string().trim().min(1),
  protocols: protocolsSchema,
  model: modelSchema.optional(),
  secretId: idSchema.optional(),
});

const updateProfileSchema = z
  .strictObject({
    name: profileNameSchema.optional(),
    baseUrl: z.string().trim().min(1).optional(),
    protocols: protocolsSchema.optional(),
    model: modelSchema.optional(),
    secretId: idSchema.optional(),
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: "At least one profile field must be updated",
  });

export class ProfileValidationError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "ProfileValidationError";
  }
}

export class ProfileInUseError extends ProfileValidationError {
  readonly code = "KHAPIMAN_PROFILE_IN_USE";

  constructor(
    readonly profileId: string,
    readonly tools: string[],
  ) {
    super(
      `Profile is active for: ${tools.join(", ")}. Roll back or switch those tools before deleting it.`,
    );
    this.name = "ProfileInUseError";
  }
}

function isLoopbackHost(hostname: string): boolean {
  const host = hostname
    .replace(/^\[|\]$/g, "")
    .replace(/\.$/, "")
    .toLowerCase();
  if (host === "localhost" || host.endsWith(".localhost")) {
    return true;
  }

  const ipVersion = isIP(host);
  if (ipVersion === 4) {
    return host.split(".", 1)[0] === "127";
  }
  if (ipVersion === 6) {
    return host === "::1" || host === "0:0:0:0:0:0:0:1";
  }
  return false;
}

export function normalizeBaseUrl(input: string): string {
  let url: URL;
  try {
    url = new URL(input.trim());
  } catch (error) {
    throw new ProfileValidationError("Base URL must be an absolute URL", {
      cause: error,
    });
  }

  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new ProfileValidationError("Base URL must use HTTPS");
  }
  if (url.protocol === "http:" && !isLoopbackHost(url.hostname)) {
    throw new ProfileValidationError(
      "Plain HTTP is allowed only for loopback addresses",
    );
  }
  if (url.username || url.password) {
    throw new ProfileValidationError("Base URL cannot contain credentials");
  }
  if (url.search || url.hash) {
    throw new ProfileValidationError(
      "Base URL cannot contain a query or fragment",
    );
  }

  return url.toString().replace(/\/+$/, "");
}

function slugify(value: string): string {
  const slug = value
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
  return slug || "profile";
}

function uniqueProfileId(state: AppState, preferred: string): string {
  const used = new Set(
    state.profiles.map((profile) => profile.id.toLowerCase()),
  );
  if (!used.has(preferred.toLowerCase())) {
    return preferred;
  }
  for (let suffix = 2; suffix < 10_000; suffix += 1) {
    const candidate = `${preferred}-${suffix}`;
    if (!used.has(candidate.toLowerCase())) {
      return candidate;
    }
  }
  throw new Error("Unable to allocate a unique profile ID");
}

function parseInput<T>(schema: z.ZodType<T>, value: unknown): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    throw new ProfileValidationError(
      parsed.error.issues.map((issue) => issue.message).join("; "),
      { cause: parsed.error },
    );
  }
  return parsed.data;
}

export class ProfileManager {
  private readonly now: () => Date;
  private readonly randomId: () => string;

  constructor(
    private readonly paths: RuntimePaths = resolveRuntimePaths(),
    options: ProfileManagerOptions = {},
  ) {
    this.now = options.now ?? (() => new Date());
    this.randomId = options.randomId ?? randomUUID;
  }

  async list(): Promise<RelayProfile[]> {
    return (await loadState(this.paths)).profiles;
  }

  async get(id: string): Promise<RelayProfile | undefined> {
    const normalizedId = idSchema.parse(id);
    return (await loadState(this.paths)).profiles.find(
      (profile) => profile.id === normalizedId,
    );
  }

  async create(input: CreateProfileInput): Promise<RelayProfile> {
    const parsed = parseInput(createProfileSchema, input);
    return withGlobalLock(this.paths, async () => {
      const state = await loadState(this.paths);
      const requestedId = parsed.id ?? slugify(parsed.name);
      const id = parsed.id ? requestedId : uniqueProfileId(state, requestedId);
      if (
        state.profiles.some(
          (profile) => profile.id.toLowerCase() === id.toLowerCase(),
        )
      ) {
        throw new ProfileValidationError(`Profile already exists: ${id}`);
      }

      const timestamp = this.now().toISOString();
      const profile: RelayProfile = {
        id,
        name: parsed.name,
        baseUrl: normalizeBaseUrl(parsed.baseUrl),
        protocols: parsed.protocols,
        ...(parsed.model === undefined ? {} : { model: parsed.model }),
        secretId: parsed.secretId ?? `profile-${this.randomId()}`,
        createdAt: timestamp,
        updatedAt: timestamp,
      };
      state.profiles.push(profile);
      await saveState(state, this.paths);
      return profile;
    });
  }

  async update(id: string, input: UpdateProfileInput): Promise<RelayProfile> {
    const normalizedId = idSchema.parse(id);
    const parsed = parseInput(updateProfileSchema, input);
    return withGlobalLock(this.paths, async () => {
      const state = await loadState(this.paths);
      const index = state.profiles.findIndex(
        (profile) => profile.id === normalizedId,
      );
      const current = state.profiles[index];
      if (index < 0 || current === undefined) {
        throw new ProfileValidationError(`Profile not found: ${normalizedId}`);
      }

      const updated: RelayProfile = {
        ...current,
        ...(parsed.name === undefined ? {} : { name: parsed.name }),
        ...(parsed.baseUrl === undefined
          ? {}
          : { baseUrl: normalizeBaseUrl(parsed.baseUrl) }),
        ...(parsed.protocols === undefined
          ? {}
          : { protocols: parsed.protocols }),
        ...(parsed.model === undefined ? {} : { model: parsed.model }),
        ...(parsed.secretId === undefined ? {} : { secretId: parsed.secretId }),
        updatedAt: this.now().toISOString(),
      };
      state.profiles[index] = updated;
      await saveState(state, this.paths);
      return updated;
    });
  }

  async delete(id: string): Promise<RelayProfile> {
    const normalizedId = idSchema.parse(id);
    return withGlobalLock(this.paths, async () => {
      const state = await loadState(this.paths);
      const index = state.profiles.findIndex(
        (profile) => profile.id === normalizedId,
      );
      const deleted = state.profiles[index];
      if (index < 0 || deleted === undefined) {
        throw new ProfileValidationError(`Profile not found: ${normalizedId}`);
      }

      const activeTools = Object.entries(state.bindings)
        .filter(([, binding]) => binding?.profileId === normalizedId)
        .map(([tool]) => tool);
      if (activeTools.length > 0) {
        throw new ProfileInUseError(normalizedId, activeTools);
      }

      state.profiles.splice(index, 1);
      await saveState(state, this.paths);
      return deleted;
    });
  }
}

export async function createProfile(
  input: CreateProfileInput,
  paths?: RuntimePaths,
): Promise<RelayProfile> {
  return new ProfileManager(paths).create(input);
}

export async function updateProfile(
  id: string,
  input: UpdateProfileInput,
  paths?: RuntimePaths,
): Promise<RelayProfile> {
  return new ProfileManager(paths).update(id, input);
}

export async function deleteProfile(
  id: string,
  paths?: RuntimePaths,
): Promise<RelayProfile> {
  return new ProfileManager(paths).delete(id);
}
