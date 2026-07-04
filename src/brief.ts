/**
 * Morning Brief — the "Good morning, Adarsh" card.
 *
 * A pure composition over the deterministic engines: health, cash, month
 * metrics with deltas, receivables, GST calendar, and pending
 * recommendations, plus a headline assembled from those same figures.
 * The AI may read this; it does not write it.
 */

import { Paise, ZERO, sub, sum, formatINR } from "./money.js";
import { Statements } from "./statements.js";
import { CashFlowIntelligence } from "./cashflow.js";
import { HealthScorer, HealthReport } from "./health.js";
import { InvoiceEngine } from "./invoices.js";
import { GstEngine, GstFiling } from "./gst.js";
import { RecommendationEngine, Recommendation } from "./recommendations.js";

export interface MonthDelta {
  readonly current: Paise;
  readonly previous: Paise;
  readonly changePct: number | null; // null when previous month is zero
}

export interface MorningBrief {
  readonly asOf: string;
  readonly health: HealthReport;
  readonly cashOnHand: Paise;
  readonly monthlyNetBurn: Paise | null;
  readonly runwayDays: number | null;
  readonly revenue: MonthDelta; // month-to-date vs full previous month
  readonly expenses: MonthDelta;
  readonly profit: MonthDelta;
  readonly profitMarginPct: number | null;
  readonly overdueCount: number;
  readonly overdueAmount: Paise;
  readonly nextFiling: GstFiling | null;
  readonly pendingRecommendations: readonly Recommendation[];
  readonly savingsIdentified: Paise; // Σ estimatedSavings across pending recommendations
  readonly headline: string;
}

export class BriefComposer {
  constructor(
    private statements: Statements,
    private cashflow: CashFlowIntelligence,
    private health: HealthScorer,
    private invoices: InvoiceEngine,
    private gst: GstEngine,
    private recommendations: RecommendationEngine,
  ) {}

  compose(asOf: string, periodFrom: string): MorningBrief {
    const month = asOf.slice(0, 7);
    const current = this.statements.profitAndLoss(`${month}-01`, asOf);
    const prevWindow = previousMonthWindow(asOf);
    const previous = this.statements.profitAndLoss(prevWindow.from, prevWindow.to);

    const revenue = delta(current.totalRevenue, previous.totalRevenue);
    const expenses = delta(current.totalExpenses, previous.totalExpenses);
    const profit = delta(current.netProfit, previous.netProfit);
    const profitMarginPct =
      current.totalRevenue > 0n ? Number((current.netProfit * 100n) / current.totalRevenue) : null;

    const metrics = this.cashflow.metrics(asOf);
    const healthReport = this.health.score(asOf, periodFrom);

    const overdue = this.invoices.overdue(asOf);
    const overdueAmount = sum(overdue.map((o) => o.outstanding));

    const upcoming = this.gst.upcomingFilings(asOf);
    const nextFiling = upcoming.find((f) => f.daysLeft >= 0) ?? upcoming[0] ?? null;

    const pending = this.recommendations.pending();
    const savingsIdentified = sum(pending.map((r) => r.estimatedSavings ?? ZERO));

    const parts: string[] = [];
    if (profit.current > 0n) {
      parts.push(`You're profitable this month: ${formatINR(profit.current)} on ${formatINR(revenue.current)} revenue.`);
    } else if (revenue.current > 0n) {
      parts.push(`Revenue is ${formatINR(revenue.current)} this month against ${formatINR(expenses.current)} of expenses.`);
    } else {
      parts.push(`No revenue recorded yet this month; expenses stand at ${formatINR(expenses.current)}.`);
    }
    if (nextFiling && nextFiling.daysLeft >= 0 && nextFiling.daysLeft <= 10) {
      parts.push(`${nextFiling.form} is due in ${nextFiling.daysLeft} day${nextFiling.daysLeft === 1 ? "" : "s"} — I've prepared the figures.`);
    }
    if (overdue.length > 0) {
      parts.push(`${formatINR(overdueAmount)} across ${overdue.length} overdue invoice${overdue.length > 1 ? "s" : ""} needs chasing.`);
    }
    if (savingsIdentified > 0n) {
      parts.push(`I found about ${formatINR(savingsIdentified)}/year in savings opportunities awaiting your review.`);
    }

    return {
      asOf,
      health: healthReport,
      cashOnHand: metrics.cashOnHand,
      monthlyNetBurn: metrics.monthlyNetBurn,
      runwayDays: metrics.runwayDays,
      revenue,
      expenses,
      profit,
      profitMarginPct,
      overdueCount: overdue.length,
      overdueAmount,
      nextFiling,
      pendingRecommendations: pending,
      savingsIdentified,
      headline: parts.join(" "),
    };
  }
}

const delta = (current: Paise, previous: Paise): MonthDelta => ({
  current,
  previous,
  changePct: previous !== 0n ? Number((sub(current, previous) * 1000n) / previous) / 10 : null,
});

const previousMonthWindow = (asOf: string): { from: string; to: string } => {
  const [y, m] = asOf.split("-").map(Number) as [number, number];
  const total = y * 12 + (m - 1) - 1;
  const ty = Math.floor(total / 12);
  const tm = ((total % 12) + 12) % 12;
  const lastDay = new Date(Date.UTC(ty, tm + 1, 0)).getUTCDate();
  const mm = String(tm + 1).padStart(2, "0");
  return { from: `${ty}-${mm}-01`, to: `${ty}-${mm}-${String(lastDay).padStart(2, "0")}` };
};
