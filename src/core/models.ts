import { z } from "zod";

import { RELAY_BASE_URL } from "../constants.js";
import { isTerminalIdentifier } from "../terminal.js";

export const MODEL_CATALOG_URL = `${RELAY_BASE_URL}/v1/models`;
export const MODEL_CATALOG_TIMEOUT_MS = 8_000;

const modelEntrySchema = z
  .object({
    id: z
      .string()
      .trim()
      .min(1)
      .max(256)
      .refine((value) => isTerminalIdentifier(value, 256)),
    object: z.literal("model").optional(),
    created: z.number().int().nonnegative().optional(),
    owned_by: z.string().trim().min(1).optional(),
  })
  .passthrough();

const modelCatalogSchema = z
  .object({
    object: z.literal("list").optional(),
    data: z.array(modelEntrySchema),
  })
  .passthrough();

export class ModelCatalogError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ModelCatalogError";
  }
}

function compareModelIds(left: string, right: string): number {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

export async function fetchModels(secret: string): Promise<string[]> {
  const apiKey = secret.trim();
  if (!apiKey) {
    throw new ModelCatalogError("An API key is required to fetch models.");
  }

  let response: Response;
  try {
    response = await fetch(MODEL_CATALOG_URL, {
      method: "GET",
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      redirect: "error",
      signal: AbortSignal.timeout(MODEL_CATALOG_TIMEOUT_MS),
    });
  } catch {
    throw new ModelCatalogError("Unable to fetch the KHaiXAPI model catalog.");
  }

  if (!response.ok) {
    throw new ModelCatalogError(
      `KHaiXAPI model catalog request failed (HTTP ${response.status}).`,
    );
  }

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new ModelCatalogError(
      "KHaiXAPI returned an invalid model catalog response.",
    );
  }

  const parsed = modelCatalogSchema.safeParse(payload);
  if (!parsed.success) {
    throw new ModelCatalogError(
      "KHaiXAPI returned an invalid model catalog response.",
    );
  }

  return [...new Set(parsed.data.data.map((model) => model.id))].sort(
    compareModelIds,
  );
}
