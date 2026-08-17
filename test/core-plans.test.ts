import { describe, expect, it } from "vitest";

import { ExpiringPlanStore } from "../src/core/plans.js";

describe("expiring apply plans", () => {
  it("expires retained values and consumes a plan only once", () => {
    let now = 1_000;
    const plans = new ExpiringPlanStore<string>({
      ttlMs: 100,
      now: () => now,
    });
    plans.set("first", "contents");
    expect(plans.take("first")).toBe("contents");
    expect(plans.take("first")).toBeUndefined();

    plans.set("expired", "sensitive contents");
    now = 1_100;
    expect(plans.take("expired")).toBeUndefined();
    expect(plans.size).toBe(0);
  });

  it("bounds memory and supports explicit cancellation", () => {
    const plans = new ExpiringPlanStore<string>({ maxEntries: 2 });
    plans.set("first", "one");
    plans.set("second", "two");
    plans.set("third", "three");
    expect(plans.take("first")).toBeUndefined();
    expect(plans.delete("second")).toBe(true);
    expect(plans.take("third")).toBe("three");
  });
});
