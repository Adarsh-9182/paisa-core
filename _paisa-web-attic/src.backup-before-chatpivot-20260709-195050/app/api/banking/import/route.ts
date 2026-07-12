import { NextResponse } from "next/server";
import { parseINR } from "paisa-core";
import { getPaisa, ACTOR } from "@/lib/engine";
import { appendAction } from "@/lib/store";

interface ParsedLine {
  date: string;
  description: string;
  amountINR: string; // signed: negative = money out
  reference: string;
}

/**
 * Parse a pasted statement. One row per line, comma- or tab-separated:
 *   date, description, amount, reference
 * A signed amount (negative = outflow). The amount and reference are read from
 * the last two columns, so descriptions may themselves contain commas. A header
 * row (containing "date" and "amount") is skipped.
 */
function parseCsv(csv: string): { lines: ParsedLine[]; errors: string[] } {
  const rows = csv.split(/\r?\n/).map((r) => r.trim()).filter(Boolean);
  const lines: ParsedLine[] = [];
  const errors: string[] = [];

  rows.forEach((row, i) => {
    if (i === 0 && /date/i.test(row) && /amount/i.test(row)) return; // header
    const cells = row.split(/\t|,/).map((c) => c.trim());
    const rowNo = i + 1;
    if (cells.length < 4) {
      errors.push(`Row ${rowNo}: expected date, description, amount, reference`);
      return;
    }
    const date = cells[0]!;
    const reference = cells[cells.length - 1]!;
    const amountRaw = (cells[cells.length - 2] ?? "").replace(/^\+/, "");
    const description = cells.slice(1, cells.length - 2).join(", ");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) errors.push(`Row ${rowNo}: date must be YYYY-MM-DD`);
    if (!description) errors.push(`Row ${rowNo}: description required`);
    if (!reference) errors.push(`Row ${rowNo}: reference required`);
    let ok = false;
    try {
      ok = parseINR(amountRaw) !== 0n;
      if (!ok) errors.push(`Row ${rowNo}: amount cannot be zero`);
    } catch {
      errors.push(`Row ${rowNo}: cannot parse amount "${cells[cells.length - 2]}"`);
    }
    if (date && description && reference && ok && /^\d{4}-\d{2}-\d{2}$/.test(date))
      lines.push({ date, description, amountINR: amountRaw, reference });
  });

  return { lines, errors };
}

export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as { bankAccountId?: string; csv?: string };
  const bankAccountId = body.bankAccountId?.trim();
  const csv = body.csv ?? "";
  if (!bankAccountId) return NextResponse.json({ error: "bankAccountId required" }, { status: 400 });
  if (!csv.trim()) return NextResponse.json({ error: "no statement provided" }, { status: 400 });

  const { org } = await getPaisa();
  try {
    org.chart.get(bankAccountId); // 400 on unknown account
  } catch {
    return NextResponse.json({ error: `Unknown account ${bankAccountId}` }, { status: 400 });
  }

  const { lines, errors } = parseCsv(csv);
  if (errors.length) return NextResponse.json({ error: errors.join("; ") }, { status: 400 });
  if (!lines.length) return NextResponse.json({ error: "no valid rows found" }, { status: 400 });

  try {
    const result = org.banking.importStatement(
      lines.map((l) => ({ date: l.date, description: l.description, amount: parseINR(l.amountINR), reference: l.reference })),
      ACTOR,
      bankAccountId,
    );
    await appendAction({ type: "import", bankAccountId, lines, actor: ACTOR, at: new Date().toISOString() });
    return NextResponse.json({
      ok: true,
      posted: result.posted.length,
      duplicates: result.duplicates.length,
      needsReview: result.needsReview.length,
    });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 400 });
  }
}
