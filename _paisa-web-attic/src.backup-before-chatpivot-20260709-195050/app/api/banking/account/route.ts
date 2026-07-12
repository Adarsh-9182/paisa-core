import { NextResponse } from "next/server";
import { parseINR, formatINR, type Paise } from "paisa-core";
import { getPaisa, ACTOR, AS_OF } from "@/lib/engine";
import { appendAction } from "@/lib/store";

/** First unused code in the bank band (1011–1099), then a wider fallback. */
function nextBankCode(used: Set<string>): string {
  for (let n = 1011; n <= 1099; n++) if (!used.has(String(n))) return String(n);
  for (let n = 1600; n <= 1999; n++) if (!used.has(String(n))) return String(n);
  throw new Error("No free account code available");
}

export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as Record<string, string | undefined>;
  const name = body.name?.trim();
  if (!name) return NextResponse.json({ error: "name required" }, { status: 400 });

  const { org } = await getPaisa();
  const usedCodes = new Set(org.chart.all().map((a) => a.code));

  let code = body.code?.trim();
  if (code) {
    if (!/^\d{3,4}$/.test(code)) return NextResponse.json({ error: "code must be 3–4 digits" }, { status: 400 });
  } else {
    code = nextBankCode(usedCodes);
  }
  const id = `acc_bank_${code}`;

  const openingRaw = body.openingINR?.trim().replace(/^\+/, "");
  const openingDate = body.openingDate?.trim() || AS_OF;
  let opening: Paise | null = null;
  if (openingRaw) {
    try {
      opening = parseINR(openingRaw);
    } catch {
      return NextResponse.json({ error: `Cannot parse opening balance "${body.openingINR}"` }, { status: 400 });
    }
    if (opening < 0n) return NextResponse.json({ error: "opening balance cannot be negative" }, { status: 400 });
    if (!/^\d{4}-\d{2}-\d{2}$/.test(openingDate))
      return NextResponse.json({ error: "openingDate must be YYYY-MM-DD" }, { status: 400 });
  }

  try {
    org.chart.add({ id, code, name, type: "ASSET", parentId: null, isCashEquivalent: true, active: true });
    const hasOpening = opening !== null && opening > 0n;
    if (hasOpening) {
      org.journal.post({
        date: openingDate,
        narration: `Opening balance: ${name}`,
        lines: [
          { accountId: id, side: "DEBIT", amount: opening! },
          { accountId: "acc_capital", side: "CREDIT", amount: opening! },
        ],
        sourceModule: "manual",
        createdBy: ACTOR,
      });
    }
    await appendAction({
      type: "add_account",
      id,
      code,
      name,
      ...(hasOpening ? { openingINR: openingRaw!, openingDate } : {}),
      actor: ACTOR,
      at: new Date().toISOString(),
    });
    return NextResponse.json({
      ok: true,
      id,
      code,
      name,
      opening: hasOpening ? formatINR(opening!) : null,
    });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 400 });
  }
}
