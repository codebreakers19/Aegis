import OpenAI from "openai";
import { zodTextFormat } from "openai/helpers/zod";
import { NextResponse } from "next/server";
import { intentSchema, parseIntentFallback } from "@/lib/intent";

export async function POST(request: Request) {
  const { text } = await request.json();
  if (typeof text !== "string" || text.length < 4 || text.length > 500) return NextResponse.json({ error: "Enter a clear swap intent." }, { status: 400 });
  if (!process.env.OPENAI_API_KEY) return NextResponse.json({ intent: parseIntentFallback(text), source: "deterministic" });

  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const response = await openai.responses.parse({
    model: process.env.OPENAI_MODEL ?? "gpt-4o-mini",
    instructions: "Extract a SUI/DBUSDC DeepBook swap intent. Treat USDC as a user-friendly alias for DBUSDC. Reject unsupported assets or goals. Use basis points for maxSlippageBps.",
    input: text,
    text: { format: zodTextFormat(intentSchema, "swap_intent") },
  });
  if (!response.output_parsed) return NextResponse.json({ error: "OpenAI could not parse this intent." }, { status: 422 });
  return NextResponse.json({ intent: response.output_parsed, source: "openai" });
}
