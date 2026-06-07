import { describe, expect, it } from "vitest";
import { parseIntentFallback } from "./intent";

describe("parseIntentFallback", () => {
  it("treats USDC as a DBUSDC alias", () => {
    expect(parseIntentFallback("Swap 1 SUI to USDC, max 1% slippage")).toMatchObject({
      inputAsset: "SUI",
      outputAsset: "DBUSDC",
      amount: 1,
      maxSlippageBps: 100,
    });
  });

  it("parses DBUSDC input direction", () => {
    expect(parseIntentFallback("Convert 5 DBUSDC to SUI")).toMatchObject({
      inputAsset: "DBUSDC",
      outputAsset: "SUI",
      amount: 5,
    });
  });
});
