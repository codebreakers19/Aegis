import { describe, expect, it } from "vitest";
import { scoreMarket, stressSnapshots } from "./guardian";

describe("scoreMarket", () => {
  it.each(["clear", "warn", "block"] as const)("renders a non-executable %s stress scenario", (scenario) => {
    const result = scoreMarket(stressSnapshots[scenario], 100, "stress");
    expect(result.verdict).toBe(scenario);
    expect(result.canExecute).toBe(false);
    expect(result.findings).toHaveLength(4);
  });

  it("allows a healthy live snapshot", () => {
    const result = scoreMarket({ midPrice: 1, expectedOutput: 0.99, spreadBps: 1, depthCoverage: 2, priceImpactBps: 5, freshnessSeconds: 5 }, 100, "live", 0.02);
    expect(result.verdict).toBe("clear");
    expect(result.canExecute).toBe(true);
    expect(result.deepRequired).toBe(0.02);
  });
});
