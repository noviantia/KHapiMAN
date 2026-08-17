import { isIP } from "node:net";

import { z } from "zod";

import { isTerminalIdentifier } from "../terminal.js";
import { PROTOCOLS, TOOL_IDS } from "../types.js";

const timestampSchema = z.iso.datetime({ offset: true });
const identifierSchema = z
  .string()
  .trim()
  .min(1)
  .max(128)
  .regex(/^[a-zA-Z0-9][a-zA-Z0-9._:-]*$/);

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

function isLoopbackHost(hostname: string): boolean {
  const host = hostname
    .replace(/^\[|\]$/g, "")
    .replace(/\.$/, "")
    .toLowerCase();
  if (host === "localhost" || host.endsWith(".localhost")) {
    return true;
  }
  if (isIP(host) === 4) {
    return host.split(".", 1)[0] === "127";
  }
  return isIP(host) === 6 && (host === "::1" || host === "0:0:0:0:0:0:0:1");
}

const baseUrlSchema = z.url().superRefine((value, context) => {
  const url = new URL(value);
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    context.addIssue({
      code: "custom",
      message: "Base URL must use HTTPS or loopback HTTP",
    });
    return;
  }
  if (url.protocol === "http:" && !isLoopbackHost(url.hostname)) {
    context.addIssue({
      code: "custom",
      message: "Plain HTTP is allowed only for loopback addresses",
    });
  }
  if (url.username || url.password || url.search || url.hash) {
    context.addIssue({
      code: "custom",
      message: "Base URL cannot contain credentials, a query, or a fragment",
    });
  }
});

export const relayProfileSchema = z.strictObject({
  id: identifierSchema,
  name: profileNameSchema,
  baseUrl: baseUrlSchema,
  protocols: z
    .array(z.enum(PROTOCOLS))
    .min(1)
    .refine((values) => new Set(values).size === values.length, {
      message: "Protocols must be unique",
    }),
  model: modelSchema.optional(),
  secretId: identifierSchema,
  createdAt: timestampSchema,
  updatedAt: timestampSchema,
});

export const toolBindingSchema = z.strictObject({
  tool: z.enum(TOOL_IDS),
  profileId: identifierSchema,
  model: modelSchema.optional(),
  appliedAt: timestampSchema,
});

export const appStateSchema = z
  .strictObject({
    schemaVersion: z.literal(1),
    profiles: z.array(relayProfileSchema),
    bindings: z.strictObject({
      codex: toolBindingSchema.optional(),
      claude: toolBindingSchema.optional(),
      opencode: toolBindingSchema.optional(),
      aider: toolBindingSchema.optional(),
    }),
  })
  .superRefine((state, context) => {
    const profileIds = new Set(state.profiles.map((profile) => profile.id));
    const normalizedProfileIds = new Set<string>();
    for (const [index, profile] of state.profiles.entries()) {
      const key = profile.id.toLowerCase();
      if (normalizedProfileIds.has(key)) {
        context.addIssue({
          code: "custom",
          path: ["profiles", index, "id"],
          message: `Duplicate profile ID: ${profile.id}`,
        });
      }
      normalizedProfileIds.add(key);
    }

    for (const tool of TOOL_IDS) {
      const binding = state.bindings[tool];
      if (binding === undefined) {
        continue;
      }
      if (binding.tool !== tool) {
        context.addIssue({
          code: "custom",
          path: ["bindings", tool, "tool"],
          message: `Binding tool must be ${tool}`,
        });
      }
      if (!profileIds.has(binding.profileId)) {
        context.addIssue({
          code: "custom",
          path: ["bindings", tool, "profileId"],
          message: `Unknown profile: ${binding.profileId}`,
        });
      }
    }
  });

export type ValidatedAppState = z.infer<typeof appStateSchema>;
