import { NextResponse } from "next/server";
import { parseINR } from "paisa-core";
import { getPaisa, ACTOR } from "@/lib/engine";
import { appendAction } from "@/lib/store";

export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as Record<string, string | undefined>;
  const { symbol, date, priceINR } = body;
  if (!symbol || !date || !priceINR) {
    return NextResponse.json({ error: "symbol, date, priceINR required" }, { status: 400 });
  }
  const { org } = await getPaisa();
  try {
    org.portfolio.mark(symbol.trim().toUpperCase(), date, parseINR(priceINR), ACTOR, "manual");
    await appendAction({ type: "mark", symbol: symbol.trim().toUpperCase(), date, priceINR, source: "manual", actor: ACTOR, at: new Date().toISOString() });
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 400 });
  }
}
