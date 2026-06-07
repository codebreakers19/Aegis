import { getFaucetHost, requestSuiFromFaucetV2 } from "@mysten/sui/faucet";
import { isValidSuiAddress } from "@mysten/sui/utils";
import { NextResponse } from "next/server";

export async function POST(request: Request) {
  const { address } = await request.json();
  if (typeof address !== "string" || !isValidSuiAddress(address)) {
    return NextResponse.json({ error: "A valid Sui address is required." }, { status: 400 });
  }
  try {
    await requestSuiFromFaucetV2({ host: getFaucetHost("testnet"), recipient: address });
    return NextResponse.json({ ok: true });
  } catch (cause) {
    return NextResponse.json({
      error: cause instanceof Error ? cause.message : "Testnet faucet request failed. The faucet may be rate limited.",
    }, { status: 502 });
  }
}
