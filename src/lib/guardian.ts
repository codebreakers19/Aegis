export type Verdict = "clear" | "warn" | "block";
export type StressScenario = "clear" | "warn" | "block";

export interface RiskFinding {
  id: "impact" | "depth" | "spread" | "freshness";
  label: string;
  score: number;
  value: string;
  explanation: string;
}

export interface GuardianResult {
  mode: "live" | "fallback" | "stress";
  dataMode: "live" | "fallback" | "stress";
  score: number;
  verdict: Verdict;
  midPrice: number;
  expectedOutput: number;
  minOutput: number;
  deepRequired: number;
  snapshotAt: string;
  canExecute: boolean;
  explanation: string;
  findings: RiskFinding[];
  checkedAt: string;
}

export interface MarketSnapshot {
  midPrice: number;
  expectedOutput: number;
  spreadBps: number;
  depthCoverage: number;
  priceImpactBps: number;
  freshnessSeconds: number;
}

const clamp = (value: number) => Math.max(0, Math.min(100, Math.round(value)));

export function scoreMarket(snapshot: MarketSnapshot, maxSlippageBps: number, mode: GuardianResult["mode"], deepRequired = 0): GuardianResult {
  const impactScore = clamp((snapshot.priceImpactBps / Math.max(maxSlippageBps, 1)) * 62);
  const depthScore = clamp((1 - Math.min(snapshot.depthCoverage, 1)) * 110);
  const spreadScore = clamp(snapshot.spreadBps * 2.6);
  const freshnessScore = clamp((snapshot.freshnessSeconds / 300) * 100);
  const score = clamp(impactScore * 0.4 + depthScore * 0.3 + spreadScore * 0.2 + freshnessScore * 0.1);
  const verdict: Verdict = score > 70 ? "block" : score >= 40 ? "warn" : "clear";
  const findings: RiskFinding[] = [
    { id: "impact", label: "Price impact", score: impactScore, value: `${(snapshot.priceImpactBps / 100).toFixed(2)}%`, explanation: impactScore > 55 ? "This order meaningfully moves through the book." : "Execution remains close to the current midpoint." },
    { id: "depth", label: "Book depth", score: depthScore, value: `${Math.round(snapshot.depthCoverage * 100)}% covered`, explanation: depthScore > 55 ? "Visible liquidity does not comfortably cover this order." : "Visible liquidity comfortably supports this order." },
    { id: "spread", label: "Market spread", score: spreadScore, value: `${snapshot.spreadBps.toFixed(1)} bps`, explanation: spreadScore > 55 ? "The bid/ask gap is wider than normal." : "The bid/ask gap is efficient." },
    { id: "freshness", label: "Market freshness", score: freshnessScore, value: `${snapshot.freshnessSeconds}s`, explanation: freshnessScore > 55 ? "Recent market activity is stale; re-check before signing." : "Market observations are current." },
  ];
  return {
    mode,
    dataMode: mode,
    score,
    verdict,
    midPrice: snapshot.midPrice,
    expectedOutput: snapshot.expectedOutput,
    minOutput: snapshot.expectedOutput * (1 - maxSlippageBps / 10_000),
    deepRequired,
    snapshotAt: new Date().toISOString(),
    checkedAt: new Date().toISOString(),
    canExecute: mode === "live" && verdict !== "block",
    explanation: findings.map((finding) => finding.explanation).join(" "),
    findings,
  };
}

export function fallbackSnapshot(amount: number, direction: "SUI" | "DBUSDC"): MarketSnapshot {
  const mid = 3.42;
  const suiAmount = direction === "SUI" ? amount : amount / mid;
  const impactBps = Math.min(150, 4 + suiAmount / 35);
  return { midPrice: mid, expectedOutput: direction === "SUI" ? amount * mid * (1 - impactBps / 10_000) : (amount / mid) * (1 - impactBps / 10_000), spreadBps: 5.4, depthCoverage: Math.max(0.35, 1.2 - suiAmount / 8000), priceImpactBps: impactBps, freshnessSeconds: 18 };
}

export const stressClearSnapshot: MarketSnapshot = { midPrice: 3.42, expectedOutput: 3.414, spreadBps: 2, depthCoverage: 1.8, priceImpactBps: 8, freshnessSeconds: 12 };
export const stressWarnSnapshot: MarketSnapshot = { midPrice: 3.42, expectedOutput: 3.35, spreadBps: 14, depthCoverage: 0.62, priceImpactBps: 82, freshnessSeconds: 130 };
export const stressBlockSnapshot: MarketSnapshot = { midPrice: 3.42, expectedOutput: 2.67, spreadBps: 38, depthCoverage: 0.31, priceImpactBps: 420, freshnessSeconds: 490 };
export const stressSnapshots: Record<StressScenario, MarketSnapshot> = {
  clear: stressClearSnapshot,
  warn: stressWarnSnapshot,
  block: stressBlockSnapshot,
};
