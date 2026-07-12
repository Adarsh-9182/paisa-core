import { Download } from "lucide-react";
import { getReports } from "@/lib/data";
import { Reveal } from "@/components/motion/reveal";
import { Card, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

export const dynamic = "force-dynamic";

function Lines({ rows }: { rows: { name: string; amount: string }[] }) {
  return (
    <>
      {rows.map((l) => (
        <tr key={l.name}>
          <td className="text-ink-2">{l.name}</td>
          <td className="num text-ink">{l.amount}</td>
        </tr>
      ))}
    </>
  );
}

function TotalRow({ label, value }: { label: string; value: string }) {
  return (
    <tr>
      <td className="!border-t-2 !border-t-ink-3/40 font-[700] text-ink">{label}</td>
      <td className="num !border-t-2 !border-t-ink-3/40 font-[700] text-ink">{value}</td>
    </tr>
  );
}

const CSV_LINKS = [
  { name: "pnl", label: "P&L" },
  { name: "balance-sheet", label: "Balance sheet" },
  { name: "cashflow", label: "Cash flow" },
  { name: "journal", label: "Journal" },
];

export default async function ReportsPage() {
  const r = await getReports();

  return (
    <div className="mx-auto max-w-[1040px]">
      <Reveal>
        <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="page-title mb-1">Reports</h1>
            <p className="page-sub">
              Period {r.period.from} → {r.period.to}. Generated from the ledger; blocked if the trial balance is imbalanced.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            {CSV_LINKS.map((l) => (
              <a
                key={l.name}
                href={`/api/reports/${l.name}`}
                download
                className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-line bg-surface px-3 text-[12.5px] font-[550] text-ink-2 no-underline shadow-[var(--shadow-xs)] transition-colors hover:border-line-strong hover:text-ink"
              >
                <Download size={13} /> {l.label}
              </a>
            ))}
          </div>
        </div>
      </Reveal>

      <div className="grid gap-3.5 lg:grid-cols-2">
        <Reveal delay={0.05}>
          <Card className="h-full p-[22px]">
            <CardTitle className="mb-2.5">Profit &amp; Loss</CardTitle>
            <table className="dtable">
              <tbody>
                <tr><th colSpan={2}>Revenue</th></tr>
                <Lines rows={r.pl.revenue} />
                <tr><th colSpan={2}>Expenses</th></tr>
                <Lines rows={r.pl.expenses} />
                <TotalRow label="Net profit" value={r.pl.netProfit} />
              </tbody>
            </table>
            <div className="card-sub mt-2.5">
              Revenue {r.pl.totalRevenue} · Expenses {r.pl.totalExpenses}
            </div>
          </Card>
        </Reveal>

        <div className="flex flex-col gap-3.5">
          <Reveal delay={0.1}>
            <Card className="p-[22px]">
              <CardTitle className="mb-2.5">Balance sheet</CardTitle>
              <table className="dtable">
                <tbody>
                  <tr><th colSpan={2}>Assets</th></tr>
                  <Lines rows={r.bs.assets} />
                  <tr><th colSpan={2}>Liabilities</th></tr>
                  <Lines rows={r.bs.liabilities} />
                  <tr><th colSpan={2}>Equity</th></tr>
                  <Lines rows={r.bs.equity} />
                  <TotalRow label="Total assets" value={r.bs.totalAssets} />
                </tbody>
              </table>
              <div className="mt-2.5 flex items-center gap-2 text-[12px] text-ink-2">
                <span>
                  Liabilities {r.bs.totalLiabilities} + Equity {r.bs.totalEquity}
                </span>
                <Badge tone={r.bs.equationHolds ? "emerald" : "rose"} size="sm">
                  {r.bs.equationHolds ? "equation holds" : "BROKEN"}
                </Badge>
              </div>
            </Card>
          </Reveal>

          <Reveal delay={0.14}>
            <Card className="p-[22px]">
              <CardTitle className="mb-2.5">Cash flow statement</CardTitle>
              <table className="dtable">
                <tbody>
                  <tr>
                    <td className="text-ink-2">Opening cash</td>
                    <td className="num text-ink">{r.cf.openingCash}</td>
                  </tr>
                  <tr>
                    <td className="text-ink-2">Inflows</td>
                    <td className="num text-emerald">{r.cf.inflows}</td>
                  </tr>
                  <tr>
                    <td className="text-ink-2">Outflows</td>
                    <td className="num text-rose">{r.cf.outflows}</td>
                  </tr>
                  <tr>
                    <td className="text-ink-2">Net change</td>
                    <td className="num text-ink">{r.cf.netChange}</td>
                  </tr>
                  <TotalRow label="Closing cash" value={r.cf.closingCash} />
                </tbody>
              </table>
            </Card>
          </Reveal>
        </div>
      </div>
    </div>
  );
}
