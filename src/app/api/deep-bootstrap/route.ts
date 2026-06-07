import { NextResponse } from "next/server";
import { DeepBookClient } from "@mysten/deepbook-v3";
import { SuiJsonRpcClient } from "@mysten/sui/jsonRpc";
import { DEEP_TYPE } from "@/lib/transaction";

const client = new SuiJsonRpcClient({ network: "testnet", url: "https://fullnode.testnet.sui.io:443" });
const REQUIRED_DEEP_BALANCE = 50_000;

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const address = String(body.address ?? "");
    if (!address.startsWith("0x")) return NextResponse.json({ error: "A connected Sui address is required." }, { status: 400 });
    const deepBalance = await client.getBalance({ owner: address, coinType: DEEP_TYPE });
    if (BigInt(deepBalance.totalBalance) >= BigInt(REQUIRED_DEEP_BALANCE)) {
      return NextResponse.json({
        alreadyReady: true,
        deepBalance: Number(deepBalance.totalBalance) / 1_000_000,
        message: "Wallet already has enough DEEP for Aegis execution.",
        snapshotAt: new Date().toISOString(),
      });
    }
    const suiAmount = Math.min(1, Math.max(0.05, Number(body.suiAmount ?? 0.3)));
    const deepbook = new DeepBookClient({ client, address, network: "testnet" });
    const quote = await deepbook.getBaseQuantityOut("DEEP_SUI", suiAmount);
    if (quote.baseOut <= 0) {
      const [book, params] = await Promise.all([
        deepbook.getLevel2TicksFromMid("DEEP_SUI", 100).catch(() => null),
        deepbook.poolBookParams("DEEP_SUI").catch(() => null),
      ]);
      const visibleAskDeep = book?.ask_quantities.reduce((sum, value) => sum + value, 0) ?? 0;
      const minSize = params?.minSize ?? 10;
      return NextResponse.json({
        error: visibleAskDeep > 0
          ? `DEEP/SUI currently has ${visibleAskDeep.toFixed(2)} DEEP visible on the ask side, below the ${minSize} DEEP executable minimum. Try again when liquidity refreshes, or use a wallet that already has DEEP.`
          : "No executable DEEP/SUI ask liquidity is currently available.",
        visibleAskDeep,
        minSize,
      }, { status: 400 });
    }
    if (quote.deepRequired > 0) return NextResponse.json({ error: "The DEEP/SUI bootstrap pool currently requires a DEEP fee, so zero-DEEP onboarding is temporarily unavailable." }, { status: 409 });
    return NextResponse.json({
      suiAmount,
      deepOut: quote.baseOut,
      minDeepOut: quote.baseOut * 0.98,
      deepRequired: quote.deepRequired,
      unspentSuiEstimate: quote.quoteOut,
      snapshotAt: new Date().toISOString(),
    });
  } catch (cause) {
    return NextResponse.json({ error: cause instanceof Error ? cause.message : "Unable to quote DEEP bootstrap." }, { status: 500 });
  }
}
