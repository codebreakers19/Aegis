import { NextResponse } from "next/server";
import { DeepBookClient } from "@mysten/deepbook-v3";
import { SuiJsonRpcClient } from "@mysten/sui/jsonRpc";
import { intentSchema } from "@/lib/intent";
import { fallbackSnapshot, type MarketSnapshot, scoreMarket, stressSnapshots, type StressScenario } from "@/lib/guardian";
import OpenAI from "openai";

const client = new SuiJsonRpcClient({ network: "testnet", url: "https://fullnode.testnet.sui.io:443" });
const deepbook = new DeepBookClient({ client, address: "0x0", network: "testnet" });

async function fetchLiveSnapshot(amount: number, inputAsset: "SUI" | "DBUSDC"): Promise<{ snapshot: MarketSnapshot; deepRequired: number }> {
  const pool = "SUI_DBUSDC";
  const [midPrice, book, quote, freshnessSeconds] = await Promise.all([
    deepbook.midPrice(pool),
    deepbook.getLevel2TicksFromMid(pool, 50),
    inputAsset === "SUI" ? deepbook.getQuoteQuantityOut(pool, amount) : deepbook.getBaseQuantityOut(pool, amount),
    deepbook.getPriceInfoObjectAge("SUI").catch(() => 20),
  ]);
  const bestBid = book.bid_prices[0] ?? midPrice;
  const bestAsk = book.ask_prices[0] ?? midPrice;
  const spreadBps = midPrice > 0 ? ((bestAsk - bestBid) / midPrice) * 10_000 : 0;
  const visibleInput = inputAsset === "SUI"
    ? book.bid_quantities.reduce((sum, value) => sum + value, 0)
    : book.ask_quantities.reduce((sum, value, index) => sum + value * (book.ask_prices[index] ?? midPrice), 0);
  const expectedOutput = inputAsset === "SUI" ? quote.quoteOut : quote.baseOut;
  const idealOutput = inputAsset === "SUI" ? amount * midPrice : amount / midPrice;
  const priceImpactBps = idealOutput > 0 ? Math.max(0, (1 - expectedOutput / idealOutput) * 10_000) : 0;
  return { snapshot: {
    midPrice,
    expectedOutput,
    spreadBps,
    depthCoverage: visibleInput / amount,
    priceImpactBps,
    freshnessSeconds: Math.max(0, Math.floor(Date.now() / 1_000 - freshnessSeconds)),
  }, deepRequired: quote.deepRequired };
}

export async function POST(request: Request) {
  const body = await request.json();
  const intent = intentSchema.parse(body.intent);
  const stress = body.stress === true;
  const stressScenario: StressScenario = ["clear", "warn", "block"].includes(body.stressScenario) ? body.stressScenario : "block";
  if (stress) return NextResponse.json(scoreMarket(stressSnapshots[stressScenario], intent.maxSlippageBps, "stress"));
  try {
    const live = await fetchLiveSnapshot(intent.amount, intent.inputAsset);
    const result = scoreMarket(live.snapshot, intent.maxSlippageBps, "live", live.deepRequired);
    if (process.env.OPENAI_API_KEY) {
      try {
        const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
        const response = await openai.responses.create({
          model: process.env.OPENAI_MODEL ?? "gpt-4o-mini",
          instructions: "Explain deterministic Aegis risk results in exactly two concise plain-English sentences. Do not change scores or verdict.",
          input: JSON.stringify({ intent, score: result.score, verdict: result.verdict, findings: result.findings, deepRequired: result.deepRequired }),
          max_output_tokens: 140,
        });
        result.explanation = response.output_text || result.explanation;
      } catch {}
    }
    return NextResponse.json(result);
  } catch {
    return NextResponse.json(scoreMarket(fallbackSnapshot(intent.amount, intent.inputAsset), intent.maxSlippageBps, "fallback"));
  }
}
