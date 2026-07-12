import { getPaisa, AS_OF, PERIOD_FROM } from "@/lib/engine";
import { rupees } from "@/lib/format";

/**
 * Cells are quoted, and any cell that a spreadsheet would treat as a formula
 * (=, +, -, @, tab) is prefixed with ' — narrations are user-influenced, so
 * a bank line like "=HYPERLINK(...)" must never execute on open.
 */
const csv = (rows: (string | number)[][]): string =>
  rows
    .map((r) =>
      r
        .map((v) => {
          let s = String(v);
          if (typeof v === "string" && /^[=+\-@\t]/.test(s)) s = `'${s}`;
          return `"${s.replace(/"/g, '""')}"`;
        })
        .join(","),
    )
    .join("\n");

export async function GET(_request: Request, { params }: { params: Promise<{ name: string }> }) {
  const { name } = await params;
  const { org } = await getPaisa();

  let rows: (string | number)[][];
  switch (name) {
    case "pnl": {
      const pl = org.statements.profitAndLoss(PERIOD_FROM, AS_OF);
      rows = [
        ["Section", "Account", "Amount (INR)"],
        ...pl.revenue.map((l) => ["Revenue", l.name, rupees(l.amount)]),
        ...pl.expenses.map((l) => ["Expenses", l.name, rupees(l.amount)]),
        ["Total", "Revenue", rupees(pl.totalRevenue)],
        ["Total", "Expenses", rupees(pl.totalExpenses)],
        ["Total", "Net profit", rupees(pl.netProfit)],
      ];
      break;
    }
    case "balance-sheet": {
      const bs = org.statements.balanceSheet(AS_OF);
      rows = [
        ["Section", "Account", "Amount (INR)"],
        ...bs.assets.map((l) => ["Assets", l.name, rupees(l.amount)]),
        ...bs.liabilities.map((l) => ["Liabilities", l.name, rupees(l.amount)]),
        ...bs.equity.map((l) => ["Equity", l.name, rupees(l.amount)]),
        ["Total", "Assets", rupees(bs.totalAssets)],
        ["Total", "Liabilities", rupees(bs.totalLiabilities)],
        ["Total", "Equity (incl. period profit)", rupees(bs.totalEquity)],
      ];
      break;
    }
    case "cashflow": {
      const cf = org.statements.cashFlow(PERIOD_FROM, AS_OF);
      rows = [
        ["Line", "Amount (INR)"],
        ["Opening cash", rupees(cf.openingCash)],
        ["Inflows", rupees(cf.inflows)],
        ["Outflows", rupees(cf.outflows)],
        ["Net change", rupees(cf.netChange)],
        ["Closing cash", rupees(cf.closingCash)],
      ];
      break;
    }
    case "journal": {
      rows = [
        ["Entry", "Date", "Narration", "Account", "Side", "Amount (INR)", "Source"],
        ...org.journal.all().flatMap((e) =>
          e.lines.map((l) => [e.id, e.date, e.narration, org.chart.get(l.accountId).name, l.side, rupees(l.amount), e.sourceModule]),
        ),
      ];
      break;
    }
    default:
      return new Response("Unknown report", { status: 404 });
  }

  return new Response(csv(rows), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="paisa-${name}-${AS_OF}.csv"`,
    },
  });
}
