import { NextResponse } from "next/server";
import { parseINR, parseQty, formatINR, type InstrumentKind, type TradeSide } from "paisa-core";
import { getPaisa, ACTOR } from "@/lib/engine";
import { appendAction } from "@/lib/store";

const KINDS: ReadonlySet<string> = new Set(["STOCK", "ETF", "MUTUAL_FUND", "FIXED_DEPOSIT", "GOLD", "BOND"]);

export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as Record<string, string | undefined>;
  const { symbol, name, kind, side, date, qty, priceINR, feesINR } = body;
  if (!symbol || !name || !kind || !side || !date || !qty || !priceINR) {
    return NextResponse.json({ error: "symbol, name, kind, side, date, qty, priceINR required" }, { status: 400 });
  }
  if (!KINDS.has(kind)) return NextResponse.json({ error: `Unknown kind ${kind}` }, { status: 400 });
  if (side !== "BUY" && side !== "SELL") return NextResponse.json({ error: "side must be BUY or SELL" }, { status: 400 });

  const { org } = await getPaisa();
  try {
    const trade = org.portfolio.record(
      {
        symbol: symbol.trim().toUpperCase(),
        name: name.trim(),
        kind: kind as InstrumentKind,
        side: side as TradeSide,
        date,
        qty: parseQty(qty),
        pricePerUnit: parseINR(priceINR),
        ...(feesINR ? { fees: parseINR(feesINR) } : {}),
      },
      ACTOR,
    );
    await appendAction({
      type: "trade",
      symbol: trade.symbol,
      name: trade.name,
      kind: trade.kind,
      side: trade.side,
      date: trade.date,
      qty,
      priceINR,
      ...(feesINR ? { feesINR } : {}),
      actor: ACTOR,
      at: new Date().toISOString(),
    });
    return NextResponse.json({ ok: true, id: trade.id, cash: formatINR(trade.cashAmount) });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 400 });
  }
}
