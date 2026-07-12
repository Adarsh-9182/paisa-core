import Link from "next/link";
import { ArrowRight, FileDown } from "lucide-react";
import {
  getBrief,
  getMetrics,
  getCashflow,
  getUpcoming,
  getTransactions,
  getRecommendations,
  getActivity,
} from "@/lib/data";
import { displayDate, displayDateLong } from "@/lib/format";
import { CashflowChart } from "@/components/cashflow-chart";
import { BriefHero } from "@/components/app/brief-hero";
import { MetricTile } from "@/components/app/metric-tile";
import { ActivityFeed } from "@/components/app/activity-feed";
import { RecommendationList } from "@/components/recommendations";
import { Reveal, Stagger, StaggerItem } from "@/components/motion/reveal";
import { Card, CardHeader, CardTitle, CardSub } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

export const dynamic = "force-dynamic";

export default async function Home() {
  const brief = await getBrief();
  const metrics = await getMetrics();
  const cashflow = await getCashflow();
  const upcoming = await getUpcoming();
  const tx = await getTransactions(6);
  const recs = await getRecommendations();
  const activity = await getActivity(9);

  const runwayValue = metrics.runway.positive ? "∞" : metrics.runway.days !== null ? `${metrics.runway.days}d` : "—";
  const runwaySub = metrics.runway.positive
    ? "you spend less than you earn"
    : metrics.runway.burn
      ? `at ${metrics.runway.burn}/mo burn`
      : metrics.runway.note;

  return (
    <div className="mx-auto max-w-[1140px]">
      <Reveal>
        <div className="mb-5 flex items-end justify-between gap-3">
          <div>
            <div className="page-sub mb-1">{displayDateLong(brief.asOf)}</div>
            <h1 className="page-title">Good morning, Adarsh</h1>
          </div>
          <Link
            href="/reports"
            className="inline-flex h-10 items-center gap-2 rounded-xl border border-line bg-surface px-4 text-[13px] font-[550] text-ink-2 no-underline shadow-[var(--shadow-xs)] transition-colors hover:border-line-strong hover:text-ink"
          >
            <FileDown size={15} /> Generate report
          </Link>
        </div>
      </Reveal>

      <Reveal delay={0.05}>
        <BriefHero
          headline={brief.headline}
          updatedLabel="Updated 6:00 AM"
          health={{ score: brief.health.score, grade: brief.health.grade }}
          recs={recs}
        />
      </Reveal>

      <Stagger className="mt-5 grid grid-cols-2 gap-3.5 lg:grid-cols-4" delay={0.1}>
        <StaggerItem>
          <MetricTile
            label="Income"
            value={metrics.revenue.value}
            raw={metrics.revenue.raw}
            format="inr"
            deltaPct={metrics.revenue.changePct}
            goodWhenUp
            sub="vs last month"
            spark={metrics.revenue.spark}
            sparkColor="var(--chart-1)"
            title={metrics.revenue.full}
          />
        </StaggerItem>
        <StaggerItem>
          <MetricTile
            label="Spending"
            value={metrics.expenses.value}
            raw={metrics.expenses.raw}
            format="inr"
            deltaPct={metrics.expenses.changePct}
            goodWhenUp={false}
            sub="vs last month"
            spark={metrics.expenses.spark}
            sparkColor="var(--chart-3)"
            title={metrics.expenses.full}
          />
        </StaggerItem>
        <StaggerItem>
          <MetricTile
            label="Saved"
            value={metrics.profit.value}
            raw={metrics.profit.raw}
            format="inr"
            sub={`${metrics.profit.marginPct ?? "—"}% of income saved`}
            spark={metrics.profit.spark}
            sparkColor="var(--chart-pos)"
            title={metrics.profit.full}
          />
        </StaggerItem>
        <StaggerItem>
          <MetricTile label="Cushion" value={runwayValue} sub={runwaySub} sparkColor="var(--chart-4)" />
        </StaggerItem>
      </Stagger>

      <div className="mt-5 grid gap-3.5 lg:grid-cols-[1.6fr_1fr]">
        <Reveal delay={0.12}>
          <Card className="p-[22px]">
            <CardHeader>
              <div>
                <CardTitle>Cash flow</CardTitle>
                <CardSub className="mt-0.5">Last 6 months · forecast dashed</CardSub>
              </div>
              <Badge tone={cashflow.depletionMonth ? "rose" : "emerald"} dot>
                {cashflow.depletionMonth ? "At risk" : "Healthy"}
              </Badge>
            </CardHeader>
            <div className="mt-3">
              <CashflowChart points={cashflow.points} />
            </div>
            <div className="mt-2 text-[12.5px] text-ink-2">
              <b className="tabnum text-ink">{cashflow.cash}</b> in bank · {cashflow.assumption}
            </div>
          </Card>
        </Reveal>

        <Reveal delay={0.16}>
          <Card className="h-full p-[22px]">
            <CardTitle>Upcoming</CardTitle>
            <CardSub className="mb-1 mt-0.5">Bills & committed payments</CardSub>
            <div className="flex flex-col">
              {upcoming.map((it, i) => (
                <div key={i} className="flex items-center justify-between gap-2 border-b border-line py-2.5 last:border-b-0">
                  <div className="min-w-0">
                    <b className="block truncate text-[13px] text-ink">{it.title}</b>
                    <span className="text-[11.5px] text-ink-3">{it.sub}</span>{" "}
                    {it.badge && <Badge tone="amber" size="sm">{it.badge}</Badge>}
                  </div>
                  <div className="shrink-0 text-right text-xs tabnum text-ink-2">
                    {displayDate(it.date)}
                    {it.amount && (
                      <>
                        <br />
                        <b className="text-ink">{it.amount}</b>
                      </>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </Card>
        </Reveal>
      </div>

      <div className="mt-3.5 grid gap-3.5 lg:grid-cols-[1fr_1fr]">
        <Reveal delay={0.06}>
          <Card className="h-full p-[22px]">
            <CardTitle>Insights & predictions</CardTitle>
            <CardSub className="mb-3 mt-0.5">Deterministic policies — every rec is auditable</CardSub>
            <RecommendationList items={recs} />
          </Card>
        </Reveal>

        <Reveal delay={0.1}>
          <Card className="h-full p-[22px]">
            <CardHeader>
              <div>
                <CardTitle>Agent activity</CardTitle>
                <CardSub className="mt-0.5">The immutable event log</CardSub>
              </div>
              <Badge tone="blue" size="sm" dot>
                live
              </Badge>
            </CardHeader>
            <div className="mt-2">
              <ActivityFeed items={activity} />
            </div>
          </Card>
        </Reveal>
      </div>

      <Reveal delay={0.06}>
        <Card className="mt-3.5 p-[22px]">
          <CardHeader>
            <div>
              <CardTitle>Recent transactions</CardTitle>
              <CardSub className="mt-0.5">
                Auto-categorised by AI{tx.needsReview > 0 && ` · ${tx.needsReview} need review`}
              </CardSub>
            </div>
            <Link href="/money" className="text-[12.5px] font-[600] text-blue-deep no-underline">
              View all
            </Link>
          </CardHeader>
          <table className="dtable mt-2">
            <tbody>
              {tx.rows.map((r, i) => (
                <tr key={i}>
                  <td>
                    <b className="text-ink">{r.narration}</b>
                    <div className="text-[11.5px] text-ink-3">
                      {r.category} · {r.date}
                    </div>
                  </td>
                  <td className={`num font-[600] ${r.direction === "in" ? "text-emerald" : "text-ink"}`}>
                    {r.direction === "in" ? "+" : "−"}
                    {r.amount}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      </Reveal>
    </div>
  );
}
