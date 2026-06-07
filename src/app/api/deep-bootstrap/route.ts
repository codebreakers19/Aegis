import { NextResponse } from "next/server";
import { DeepBookClient } from "@mysten/deepbook-v3";
import { SuiJsonRpcClient } from "@mysten/sui/jsonRpc";

const client = new SuiJsonRpcClient({ network: "testnet", url: "https://fullnode.testnet.sui.io:443" });

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const address = String(body.address ?? "");
    if (!address.startsWith("0x")) return NextResponse.json({ error: "A connected Sui address is required." }, { status: 400 });
    const suiAmount = Math.min(1, Math.max(0.05, Number(body.suiAmount ?? 0.3)));
    const deepbook = new DeepBookClient({ client, address, network: "testnet" });
    const book = await deepbook.getLevel2TicksFromMid("DEEP_SUI", 100);
    let remainingSui = suiAmount;
    let deepOut = 0;
    for (let index = 0; index < book.ask_prices.length && remainingSui > 0; index += 1) {
      const price = book.ask_prices[index];
      const availableDeep = book.ask_quantities[index];
      const purchasableDeep = Math.min(availableDeep, remainingSui / price);
      deepOut += purchasableDeep;
      remainingSui -= purchasableDeep * price;
    }
    if (deepOut <= 0) return NextResponse.json({ error: "No visible DEEP/SUI ask liquidity is currently available." }, { status: 400 });
    return NextResponse.json({
      suiAmount,
      deepOut,
      minDeepOut: deepOut * 0.98,
      unspentSuiEstimate: Math.max(0, remainingSui),
      snapshotAt: new Date().toISOString(),
    });
  } catch (cause) {
    return NextResponse.json({ error: cause instanceof Error ? cause.message : "Unable to quote DEEP bootstrap." }, { status: 500 });
  }
}
