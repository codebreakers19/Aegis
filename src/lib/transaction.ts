import { DeepBookClient, testnetPools } from "@mysten/deepbook-v3";
import { SuiJsonRpcClient } from "@mysten/sui/jsonRpc";
import { Transaction } from "@mysten/sui/transactions";
import type { GuardianResult } from "./guardian";
import type { ParsedIntent } from "./intent";

export const CLOCK_ID = "0x6";
export const SUI_DBUSDC_POOL_ID = testnetPools.SUI_DBUSDC.address;
export const DEEP_SUI_POOL_ID = testnetPools.DEEP_SUI.address;
export const SUI_TYPE = "0x2::sui::SUI";
export const DEEP_TYPE = "0x36dbef866a1d62bf7328989a10fb2f07d769f4ee587c0de4a0a256e57e0a58a8::deep::DEEP";
export const DBUSDC_TYPE = "0xf7152c05930480cd740d7311b5b8b45c6f488e3a53a11c3f74a6fac36a52e0d7::DBUSDC::DBUSDC";
export const AEGIS_GAS_BUDGET = 50_000_000;

export interface ExecutionPlan {
  policyId: string;
  poolId: string;
  direction: 0 | 1;
  inputAsset: "SUI" | "DBUSDC";
  outputAsset: "SUI" | "DBUSDC";
  amount: number;
  amountAtomic: bigint;
  minOutput: number;
  minOutputAtomic: bigint;
  deepRequired: number;
  deepBudget: number;
  maxSlippageBps: number;
  guardianScore: number;
  guardianVerdict: GuardianResult["verdict"];
  dataMode: GuardianResult["dataMode"];
  createdAt: string;
  intent: ParsedIntent;
}

export interface PolicyInput {
  maxSuiInput: number;
  maxDbusdcInput: number;
  maxSlippageBps: number;
  expiresAtMs: number;
}

export interface ExecutionPolicyStatus {
  objectId: string;
  maxSuiInput: number;
  maxDbusdcInput: number;
  maxSlippageBps: number;
  allowedPool: string;
  expiresAtMs: number;
  revoked: boolean;
}

export function executionConfig() {
  const packageId = process.env.NEXT_PUBLIC_GUARDIAN_PACKAGE_ID;
  return packageId ? { packageId } : null;
}

export function createExecutionPlan(intent: ParsedIntent, guardian: GuardianResult, policyId: string): ExecutionPlan {
  const inputScalar = intent.inputAsset === "SUI" ? 1e9 : 1e6;
  const outputScalar = intent.outputAsset === "SUI" ? 1e9 : 1e6;
  return {
    policyId,
    poolId: SUI_DBUSDC_POOL_ID,
    direction: intent.inputAsset === "SUI" ? 0 : 1,
    inputAsset: intent.inputAsset,
    outputAsset: intent.outputAsset,
    amount: intent.amount,
    amountAtomic: BigInt(Math.round(intent.amount * inputScalar)),
    minOutput: guardian.minOutput,
    minOutputAtomic: BigInt(Math.floor(guardian.minOutput * outputScalar)),
    deepRequired: guardian.deepRequired,
    deepBudget: Math.max(guardian.deepRequired * 1.15, 0.001),
    maxSlippageBps: intent.maxSlippageBps,
    guardianScore: guardian.score,
    guardianVerdict: guardian.verdict,
    dataMode: guardian.dataMode,
    createdAt: guardian.snapshotAt,
    intent,
  };
}

export function isPlanFresh(plan: ExecutionPlan, now = Date.now()) {
  return now - new Date(plan.createdAt).getTime() <= 60_000;
}

export function executionBlockReason(plan: ExecutionPlan | null, policy: ExecutionPolicyStatus | null, now = Date.now()) {
  if (!plan) return "Generate an execution plan.";
  if (!policy || policy.objectId !== plan.policyId) return "A matching active GuardianPolicy is required.";
  if (policy.revoked) return "GuardianPolicy is revoked.";
  if (policy.expiresAtMs <= now) return "GuardianPolicy is expired.";
  if (policy.allowedPool !== plan.poolId) return "GuardianPolicy does not allow this pool.";
  if (plan.maxSlippageBps > policy.maxSlippageBps) return "Intent slippage exceeds the policy limit.";
  if (plan.inputAsset === "SUI" && plan.amount > policy.maxSuiInput) return "SUI amount exceeds the policy ceiling.";
  if (plan.inputAsset === "DBUSDC" && plan.amount > policy.maxDbusdcInput) return "DBUSDC amount exceeds the policy ceiling.";
  if (plan.dataMode !== "live") return "Only live DeepBook data can execute.";
  if (plan.guardianVerdict === "block") return "Aegis blocked this plan.";
  if (!isPlanFresh(plan, now)) return "Execution plan is stale.";
  return null;
}

export function buildIntentTransaction(address: string, plan: ExecutionPlan) {
  const config = executionConfig();
  if (!config) throw new Error("Publish Aegis and configure NEXT_PUBLIC_GUARDIAN_PACKAGE_ID first.");
  if (plan.dataMode !== "live" || plan.guardianVerdict === "block") throw new Error("Only live, non-blocked Aegis plans can execute.");
  if (!isPlanFresh(plan)) throw new Error("Execution plan is stale. Re-run Aegis before signing.");

  const client = new SuiJsonRpcClient({ network: "testnet", url: "https://fullnode.testnet.sui.io:443" });
  const deepbook = new DeepBookClient({ client, address, network: "testnet" });
  const tx = new Transaction();

  tx.moveCall({
    target: `${config.packageId}::guardian::assert_compliant`,
    arguments: [
      tx.object(plan.policyId),
      tx.pure.u8(plan.direction),
      tx.pure.u64(plan.amountAtomic),
      tx.pure.u64(plan.maxSlippageBps),
      tx.pure.id(plan.poolId),
      tx.object(CLOCK_ID),
    ],
  });

  const swap = plan.direction === 0
    ? deepbook.deepBook.swapExactBaseForQuote({
      poolKey: "SUI_DBUSDC",
      amount: plan.amount,
      deepAmount: plan.deepBudget,
      minOut: plan.minOutput,
    })(tx)
    : deepbook.deepBook.swapExactQuoteForBase({
      poolKey: "SUI_DBUSDC",
      amount: plan.amount,
      deepAmount: plan.deepBudget,
      minOut: plan.minOutput,
    })(tx);
  const [baseOut, quoteOut, deepOut] = swap;
  tx.transferObjects([baseOut, quoteOut, deepOut], address);

  const receipt = tx.moveCall({
    target: `${config.packageId}::guardian::mint_receipt`,
    arguments: [
      tx.object(plan.policyId),
      tx.pure.vector("u8", Array.from(new TextEncoder().encode(JSON.stringify(plan.intent)))),
      tx.pure.id(plan.poolId),
      tx.pure.u8(plan.direction),
      tx.pure.u64(plan.amountAtomic),
      tx.pure.u64(plan.minOutputAtomic),
      tx.pure.u8(plan.guardianScore),
      tx.pure.string(plan.guardianVerdict),
      tx.object(CLOCK_ID),
    ],
  });
  tx.transferObjects([receipt], address);
  tx.setGasBudget(AEGIS_GAS_BUDGET);
  return tx;
}

export function buildCreatePolicyTransaction(address: string, input: PolicyInput) {
  const config = executionConfig();
  if (!config) throw new Error("Aegis package is not configured.");
  const tx = new Transaction();
  const policy = tx.moveCall({
    target: `${config.packageId}::guardian::create_policy`,
    arguments: [
      tx.pure.u64(BigInt(Math.round(input.maxSuiInput * 1e9))),
      tx.pure.u64(BigInt(Math.round(input.maxDbusdcInput * 1e6))),
      tx.pure.u64(input.maxSlippageBps),
      tx.pure.id(SUI_DBUSDC_POOL_ID),
      tx.pure.u64(input.expiresAtMs),
    ],
  });
  tx.transferObjects([policy], address);
  return tx;
}

export function buildUpdatePolicyTransaction(policyId: string, input: PolicyInput) {
  const config = executionConfig();
  if (!config) throw new Error("Aegis package is not configured.");
  const tx = new Transaction();
  tx.moveCall({
    target: `${config.packageId}::guardian::update_policy`,
    arguments: [
      tx.object(policyId),
      tx.pure.u64(BigInt(Math.round(input.maxSuiInput * 1e9))),
      tx.pure.u64(BigInt(Math.round(input.maxDbusdcInput * 1e6))),
      tx.pure.u64(input.maxSlippageBps),
      tx.pure.u64(input.expiresAtMs),
    ],
  });
  return tx;
}

export function buildRevokePolicyTransaction(policyId: string) {
  const config = executionConfig();
  if (!config) throw new Error("Aegis package is not configured.");
  const tx = new Transaction();
  tx.moveCall({ target: `${config.packageId}::guardian::revoke_policy`, arguments: [tx.object(policyId), tx.object(CLOCK_ID)] });
  return tx;
}

export function buildDeepBootstrapTransaction(address: string, suiAmount: number, minDeepOut: number) {
  const client = new SuiJsonRpcClient({ network: "testnet", url: "https://fullnode.testnet.sui.io:443" });
  const deepbook = new DeepBookClient({ client, address, network: "testnet" });
  const tx = new Transaction();
  // DEEP_SUI base is DEEP and quote is SUI. Supplying exact quote (SUI)
  // returns base (DEEP), so amount is SUI units and minOut is DEEP units.
  const [deepOut, suiOut, feeOut] = deepbook.deepBook.swapExactQuoteForBase({
    poolKey: "DEEP_SUI",
    amount: suiAmount,
    deepAmount: 0,
    minOut: minDeepOut,
  })(tx);
  tx.transferObjects([deepOut, suiOut, feeOut], address);
  tx.setGasBudget(AEGIS_GAS_BUDGET);
  return tx;
}

export async function simulateTransaction(tx: Transaction, address: string) {
  const client = new SuiJsonRpcClient({ network: "testnet", url: "https://fullnode.testnet.sui.io:443" });
  tx.setSender(address);
  const result = await client.dryRunTransactionBlock({ transactionBlock: await tx.build({ client }) });
  const gas = result.effects.gasUsed;
  const totalGas = BigInt(gas.computationCost) + BigInt(gas.storageCost) - BigInt(gas.storageRebate);
  return {
    success: result.effects.status.status === "success",
    error: result.effects.status.error,
    gasEstimate: `${(Number(totalGas) / 1_000_000_000).toFixed(6)} SUI`,
  };
}
