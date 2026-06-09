export const siteConfig = {
  name: "Aegis",
  title: "Aegis | Guarded AI Intent Execution on Sui",
  description:
    "Aegis turns plain-English DeFi goals into guarded Sui programmable transaction blocks using live DeepBook risk analysis, Move policy enforcement, explicit confirmation, and on-chain receipts.",
  shortDescription:
    "AI-assisted DeFi intents protected by Sui Move policies and live DeepBook risk checks.",
  keywords: [
    "Aegis",
    "Sui",
    "Sui Move",
    "DeepBook",
    "AI intent engine",
    "DeFi",
    "programmable transaction block",
    "PTB",
    "GuardianPolicy",
    "IntentReceipt",
    "Agentic Web",
    "crypto risk",
  ],
  url: (process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000").replace(/\/$/, ""),
};
