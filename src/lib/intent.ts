import { z } from "zod";

export const intentSchema = z.object({
  kind: z.literal("swap"),
  inputAsset: z.enum(["SUI", "DBUSDC"]),
  outputAsset: z.enum(["SUI", "DBUSDC"]),
  amount: z.number().positive().max(1_000_000),
  maxSlippageBps: z.number().int().min(10).max(1_000),
  riskTolerance: z.enum(["low", "medium", "high"]),
}).refine((value) => value.inputAsset !== value.outputAsset, "Assets must differ");

export type ParsedIntent = z.infer<typeof intentSchema>;

export function parseIntentFallback(text: string): ParsedIntent {
  const normalized = text.toLowerCase();
  const amount = Number(normalized.match(/(?:swap|trade|convert|sell|buy)?\s*\$?([\d,.]+)/)?.[1]?.replaceAll(",", "") ?? 25);
  const mentionsStable = normalized.includes("usdc") || normalized.includes("dbusdc");
  const stableIsOutput = normalized.match(/(?:to|for|into)\s+d?busdc/) || normalized.match(/(?:to|for|into)\s+usdc/);
  const inputAsset = mentionsStable && !stableIsOutput ? "DBUSDC" : "SUI";
  const outputAsset = inputAsset === "SUI" ? "DBUSDC" : "SUI";
  const slippage = Number(normalized.match(/([\d.]+)\s*%\s*(?:max\s*)?slippage/)?.[1] ?? (normalized.includes("safe") ? 0.5 : 1));
  const riskTolerance = normalized.includes("aggressive") ? "high" : normalized.includes("safe") || normalized.includes("careful") ? "low" : "medium";
  return intentSchema.parse({ kind: "swap", inputAsset, outputAsset, amount, maxSlippageBps: Math.round(slippage * 100), riskTolerance });
}
