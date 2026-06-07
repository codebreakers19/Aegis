import { describe, expect, it } from "vitest";
import type { GuardianResult } from "./guardian";
import type { ParsedIntent } from "./intent";
import { createExecutionPlan, executionBlockReason, SUI_DBUSDC_POOL_ID } from "./transaction";

const intent: ParsedIntent = { kind: "swap", inputAsset: "SUI", outputAsset: "DBUSDC", amount: 1, maxSlippageBps: 100, riskTolerance: "low" };
const guardian: GuardianResult = {
  mode: "live", dataMode: "live", score: 12, verdict: "clear", midPrice: 0.75, expectedOutput: 0.747,
  minOutput: 0.73953, deepRequired: 0.02, snapshotAt: "2026-06-07T00:00:00.000Z", checkedAt: "2026-06-07T00:00:00.000Z",
  canExecute: true, explanation: "Healthy.", findings: [],
};
const policy = {
  objectId: "0xpolicy", maxSuiInput: 5, maxDbusdcInput: 10, maxSlippageBps: 200,
  allowedPool: SUI_DBUSDC_POOL_ID, expiresAtMs: Date.parse("2026-06-08T00:00:00.000Z"), revoked: false,
};

describe("execution plans", () => {
  it("uses correct atomic units and one shared pool", () => {
    const plan = createExecutionPlan(intent, guardian, policy.objectId);
    expect(plan.amountAtomic).toBe(1_000_000_000n);
    expect(plan.minOutputAtomic).toBe(739_530n);
    expect(plan.poolId).toBe(SUI_DBUSDC_POOL_ID);
  });

  it("blocks fallback, stale, revoked, and over-ceiling plans", () => {
    const plan = createExecutionPlan(intent, guardian, policy.objectId);
    const freshNow = Date.parse("2026-06-07T00:00:10.000Z");
    expect(executionBlockReason(plan, policy, freshNow)).toBeNull();
    expect(executionBlockReason({ ...plan, dataMode: "fallback" }, policy, freshNow)).toContain("live");
    expect(executionBlockReason(plan, { ...policy, revoked: true }, freshNow)).toContain("revoked");
    expect(executionBlockReason({ ...plan, amount: 6 }, policy, freshNow)).toContain("ceiling");
    expect(executionBlockReason(plan, policy, Date.parse("2026-06-07T00:01:00.000Z"))).toContain("stale");
  });
});
