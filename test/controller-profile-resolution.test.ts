import { describe, expect, it } from "vitest";

import { findProfile } from "../src/controller.js";
import type { AppState, RelayProfile } from "../src/types.js";

function profile(id: string, name: string): RelayProfile {
  return {
    id,
    name,
    baseUrl: "https://api.khaix.net",
    protocols: ["openai-chat"],
    secretId: `secret-${id}`,
    createdAt: "2026-08-17T00:00:00.000Z",
    updatedAt: "2026-08-17T00:00:00.000Z",
  };
}

describe("profile resolution", () => {
  it("prefers an exact ID over an earlier profile with the same name", () => {
    const expected = profile("foo", "foo");
    const state: AppState = {
      schemaVersion: 1,
      profiles: [profile("foo-2", "foo"), expected],
      bindings: {},
    };
    expect(findProfile(state, "foo")).toBe(expected);
  });

  it("allows a unique name but rejects an ambiguous name", () => {
    const state: AppState = {
      schemaVersion: 1,
      profiles: [profile("first", "Team"), profile("second", "Team")],
      bindings: {},
    };
    expect(findProfile(state, "first").id).toBe("first");
    expect(() => findProfile(state, "Team")).toThrow(/ambiguous/i);
  });
});
