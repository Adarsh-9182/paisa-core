import { getInvestments } from "@/lib/data";
import { RecommendationList } from "@/components/recommendations";
import { MetricTile } from "@/components/app/metric-tile";
import { TradeForm } from "@/components/trade-form";
import { AllocationDonut } from "@/components/charts/allocation-donut";
import { Reveal, Stagger, StaggerItem } from "@/components/motion/reveal";
import { Card, CardTitle, CardSub } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { AS_OF } from "@/lib/engine";
import { displayDate } from "@/lib/format";
import { TrendingUp } from "lucide-react";

export const dynamic = "force-dynamic";

export default async function InvestmentsPage() {
  const inv = await getInvestments();
  const p = inv.portfolio;

  return (
    <div className="mx-auto max-w-[1040px]">
      <Reveal>
        <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="page-title mb-1">Investments</h1>
            <p className="page-sub max-w-[62ch]">
              Every position comes off the trade ledger; market values exist only where a price is marked — never guessed.
            </p>
          </div>
          <TradeForm asOf={AS_OF} />
        </div>
      </Reveal>

      <Stagger className="mb-4 grid grid-cols-2 gap-3.5 lg:grid-cols-4">
        <StaggerItem>
          <MetricTile label="Invested" value={p.investedCompact} title={p.invested} sub="open cost basis" />
        </StaggerItem>
        <StaggerItem>
          <MetricTile
            label="Market value"
            value={p.markedValueCompact}
            title={p.markedValue}
            sub={p.unmarkedSymbols.length ? `marked only · ${p.unmarkedSymbols.length} unmarked` : "all holdings marked"}
          />
        </StaggerItem>
        <StaggerItem>
          <MetricTile
            label="Unrealized P&L"
            value={p.unrealizedPnl}
            deltaPct={p.unrealizedPct}
            goodWhenUp
            sub={p.unrealizedPct !== null ? "on marked cost" : "no marked holdings"}
          />
        </StaggerItem>
        <StaggerItem>
          <MetricTile label="Realized P&L" value={p.realizedPnl} sub="booked to P&L on sale" />
        </StaggerItem>
      </Stagger>

      <div className="mb-4 grid gap-3.5 lg:grid-cols-[1fr_1.5fr]">
        <Reveal delay={0.06}>
          <Card className="h-full p-[22px]">
            <CardTitle>Allocation</CardTitle>
            <CardSub className="mb-4 mt-0.5">Marked value where available, cost otherwise.</CardSub>
            {p.allocation.length ? (
              <AllocationDonut data={p.allocation} centerValue={p.markedValueCompact} centerLabel="value" />
            ) : (
              <EmptyState icon={TrendingUp} title="No open positions" description="Record your first trade to see allocation." />
            )}
            <div className="mt-5 border-t border-line pt-3 text-[12px] leading-relaxed text-ink-2">
              <b className="tabnum text-ink">{inv.cashCompact}</b> investable cash ·{" "}
              <b className="text-ink">{inv.coverageMonths !== null ? `${inv.coverageMonths} mo` : "—"}</b> of expenses covered
              <div className="text-[11.5px] text-ink-3">avg monthly spend {inv.avgMonthlyExpenses} (trailing 3 months)</div>
            </div>
          </Card>
        </Reveal>

        <Reveal delay={0.1}>
          <Card className="h-full p-[22px]">
            <CardTitle>Holdings</CardTitle>
            <CardSub className="mb-1.5 mt-0.5">Weighted-average cost basis · marked to the latest observed price.</CardSub>
            <div className="overflow-x-auto">
              <table className="dtable">
                <thead>
                  <tr>
                    <th>Instrument</th>
                    <th className="num">Qty</th>
                    <th className="num">Avg cost</th>
                    <th className="num">Value</th>
                    <th className="num">Unrealized</th>
                  </tr>
                </thead>
                <tbody>
                  {p.holdings.map((h) => (
                    <tr key={h.symbol}>
                      <td>
                        <b className="text-ink">{h.symbol}</b> <Badge tone="muted" size="sm">{h.kind}</Badge>
                        <div className="text-[11.5px] text-ink-3">
                          {h.name}
                          {h.markDate ? ` · marked ${displayDate(h.markDate)} @ ${h.markPrice}` : " · no price marked"}
                        </div>
                      </td>
                      <td className="num text-ink-2">{h.qty}</td>
                      <td className="num text-ink-2">{h.avgCost}</td>
                      <td className="num font-[600] text-ink" title={`cost basis ${h.costBasis}`}>
                        {h.marketValue ?? h.costBasis}
                        {h.marketValue === null && <div className="text-[10.5px] font-normal text-ink-3">at cost</div>}
                      </td>
                      <td
                        className="num font-[600]"
                        style={{ color: h.unrealizedUp === null ? "var(--ink-3)" : h.unrealizedUp ? "var(--emerald)" : "var(--rose)" }}
                      >
                        {h.unrealizedPnl ?? "—"}
                        {h.unrealizedPct !== null && (
                          <div className="text-[10.5px] font-normal">
                            {h.unrealizedPct > 0 ? "+" : ""}
                            {h.unrealizedPct}%
                          </div>
                        )}
                      </td>
                    </tr>
                  ))}
                  {p.holdings.length === 0 && (
                    <tr>
                      <td colSpan={5} className="py-3 text-[12.5px] text-ink-3">
                        No open positions — record your first trade above.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
            {p.unmarkedSymbols.length > 0 && (
              <div className="mt-2 text-[11.5px] text-ink-3">
                {p.unmarkedSymbols.join(", ")} {p.unmarkedSymbols.length === 1 ? "has" : "have"} no marked price, so Paisa shows cost and declares it — it never invents a market value.
              </div>
            )}
          </Card>
        </Reveal>
      </div>

      {inv.idleCashRec && (
        <Reveal delay={0.06}>
          <div className="mb-4">
            <RecommendationList items={[inv.idleCashRec]} />
          </div>
        </Reveal>
      )}

      <Reveal delay={0.1}>
        <Card className="p-[22px]">
          <CardTitle>Trades</CardTitle>
          <CardSub className="mb-1.5 mt-0.5">Newest first · each one posted a balanced journal entry.</CardSub>
          <div className="overflow-x-auto">
            <table className="dtable">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Side</th>
                  <th>Instrument</th>
                  <th className="num">Qty</th>
                  <th className="num">Price</th>
                  <th className="num">Cash moved</th>
                  <th className="num">Realized P&L</th>
                </tr>
              </thead>
              <tbody>
                {p.trades.map((t) => (
                  <tr key={t.id}>
                    <td className="tabnum text-ink-2">{t.date}</td>
                    <td>
                      <Badge tone={t.side === "BUY" ? "blue" : "amber"} size="sm">{t.side}</Badge>
                    </td>
                    <td>
                      <b className="text-ink">{t.symbol}</b>
                      <div className="text-[11.5px] text-ink-3">{t.name}</div>
                    </td>
                    <td className="num text-ink-2">{t.qty}</td>
                    <td className="num text-ink-2">{t.price}</td>
                    <td className="num text-ink">{t.cash}</td>
                    <td
                      className="num font-[600]"
                      style={{ color: t.realizedUp === null ? "var(--ink-3)" : t.realizedUp ? "var(--emerald)" : "var(--rose)" }}
                    >
                      {t.realizedPnl ?? "—"}
                    </td>
                  </tr>
                ))}
                {p.trades.length === 0 && (
                  <tr>
                    <td colSpan={7} className="py-3 text-[12.5px] text-ink-3">
                      No trades yet.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </Card>
      </Reveal>
    </div>
  );
}
