import { afterEach, describe, expect, it, vi } from "vitest";

import { Controller } from "../src/controller.js";
import {
  MODEL_CATALOG_TIMEOUT_MS,
  MODEL_CATALOG_URL,
  ModelCatalogError,
  fetchModels,
} from "../src/core/models.js";

afterEach(() => {
  vi.unstubAllGlobals();
});

async function captureError(operation: Promise<unknown>): Promise<Error> {
  try {
    await operation;
  } catch (error) {
    if (error instanceof Error) return error;
    throw new Error("Expected an Error instance", { cause: error });
  }
  throw new Error("Expected operation to reject");
}

describe("KHaiXAPI model catalog", () => {
  it("uses the fixed authenticated endpoint and returns sorted unique IDs", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          object: "list",
          provider: "khaix",
          data: [
            {
              id: "zeta-model",
              object: "model",
              created: 1,
              owned_by: "khaix",
              context_length: 200_000,
            },
            { id: "alpha-model" },
            { id: "zeta-model" },
          ],
        }),
        { status: 200 },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      new Controller().fetchModels("  sk-test-key  "),
    ).resolves.toEqual(["alpha-model", "zeta-model"]);

    expect(fetchMock).toHaveBeenCalledOnce();
    const call = fetchMock.mock.calls[0];
    if (!call) throw new Error("Expected fetch to be called");
    const [url, init] = call;
    expect(url).toBe(MODEL_CATALOG_URL);
    expect(init?.method).toBe("GET");
    expect(init?.redirect).toBe("error");
    expect(init?.signal).toBeInstanceOf(AbortSignal);
    expect(MODEL_CATALOG_TIMEOUT_MS).toBe(8_000);
    const headers = new Headers(init?.headers);
    expect(headers.get("accept")).toBe("application/json");
    expect(headers.get("authorization")).toBe("Bearer sk-test-key");
  });

  it("rejects malformed model identifiers", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          data: [{ id: "valid" }, { id: "forged\nmodel" }],
          unexpected: true,
        }),
        { status: 200 },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(fetchModels("sk-test-key")).rejects.toMatchObject({
      name: "ModelCatalogError",
      message: "KHaiXAPI returned an invalid model catalog response.",
    });
  });

  it("never exposes the API key in transport or HTTP errors", async () => {
    const secret = "sk-never-print-this";
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockRejectedValueOnce(new Error(`transport failed for ${secret}`))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ error: `invalid ${secret}` }), {
          status: 401,
        }),
      );
    vi.stubGlobal("fetch", fetchMock);

    const transportError = await captureError(fetchModels(secret));
    expect(transportError).toBeInstanceOf(ModelCatalogError);
    expect(transportError.message).not.toContain(secret);

    const httpError = await captureError(fetchModels(secret));
    expect(httpError).toBeInstanceOf(ModelCatalogError);
    expect(httpError.message).toBe(
      "KHaiXAPI model catalog request failed (HTTP 401).",
    );
    expect(httpError.message).not.toContain(secret);
  });

  it("rejects an empty API key without making a request", async () => {
    const fetchMock = vi.fn<typeof fetch>();
    vi.stubGlobal("fetch", fetchMock);

    await expect(fetchModels("  ")).rejects.toBeInstanceOf(ModelCatalogError);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
