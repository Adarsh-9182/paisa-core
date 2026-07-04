/**
 * Financial Health Score — Paisa's signature 0–100 metric.
 * Every component is deterministic, explained, and flags missing data
 * instead of guessing. Weights are configurable business rules, not
 * AI behavior.
 */

import { Paise, ZERO, add, sub, sum } from "./money.js";
import { ChartOfAccounts } from "./accounts.js";
import { Ledger } from "./ledger.js";
import { Statements } from "./statements.js";
import { CashFlowIntelligence } from "./cashflow.js";
import type { InvoiceEngine } from "./invoices.js";

export interface HealthComponent {
  readonly name: string;
  readonly score: number; // 0-100
  readonly weight: number; // 0-1, weights sum to 1 across available components
  readonly detail: string;
  readonly dataAvailable: boolean;
}

export interface HealthReport {
  readonly asOf: string;
  readonly score: number; // 0-100
  readonly grade: "Excellent" | "Good" | "Fair" | "Poor" | "Critical";
  readonly components: readonly HealthComponent[];
  readonly missing: readonly string[];
}

const clamp = (n: number, lo = 0, hi = 100) => Math.max(lo, Math.min(hi, n));

export class HealthScorer {
  constructor(
    private chart: ChartOfAccounts,
    private ledger: Ledger,
    private statements: Statements,
    private cashflow: CashFlowIntelligence,
    private invoices?: InvoiceEngine,
  ) {}

  score(asOf: string, periodFrom: string): HealthReport {
    const components: HealthComponent[] = [];
    const missing: string[] = [];

    // 1. Liquidity — current ratio proxy: (cash + AR) vs current liabilities
    const cash = this.cashflow.cashOnHand(asOf);
    const ar = safeBalance(this.ledger, "acc_ar", asOf);
    const liabilities = this.chart
      .ofType("LIABILITY")
      .reduce<Paise>((s, a) => add(s, this.ledger.balance(a.id, asOf)), ZERO);
    if (liabilities > 0n) {
      const ratioPct = Number(((cash + ar) * 100n) / liabilities); // 100 = 1.0x
      const liquidityScore = clamp((ratioPct / 200) * 100); // 2.0x coverage = full marks
      components.push({
        name: "Liquidity",
        score: Math.round(liquidityScore),
        weight: 0.3,
        detail: `Liquid assets cover ${(ratioPct / 100).toFixed(2)}x of liabilities`,
        dataAvailable: true,
      });
    } else {
      components.push({
        name: "Liquidity",
        score: 100,
        weight: 0.3,
        detail: "No outstanding liabilities",
        dataAvailable: true,
      });
    }

    // 2. Profitability — net margin over the period
    const pl = this.statements.profitAndLoss(periodFrom, asOf);
    if (pl.totalRevenue > 0n) {
      const marginPct = Number((pl.netProfit * 100n) / pl.totalRevenue);
      const profitScore = clamp(50 + marginPct * 2.5); // 0% margin=50, 20%=100, -20%=0
      components.push({
        name: "Profitability",
        score: Math.round(profitScore),
        weight: 0.3,
        detail: `Net margin ${marginPct}% over ${periodFrom} → ${asOf}`,
        dataAvailable: true,
      });
    } else {
      missing.push("Revenue history for the period (profitability not scored)");
      components.push({ name: "Profitability", score: 0, weight: 0, detail: "No revenue recorded in period", dataAvailable: false });
    }

    // 3. Runway
    const cm = this.cashflow.metrics(asOf);
    if (cm.monthlyNetBurn === null) {
      missing.push("Cash-flow history (runway not scored)");
      components.push({ name: "Runway", score: 0, weight: 0, detail: cm.note, dataAvailable: false });
    } else if (cm.runwayDays === null) {
      components.push({ name: "Runway", score: 100, weight: 0.25, detail: "Cash-flow positive", dataAvailable: true });
    } else {
      const runwayScore = clamp((cm.runwayDays / 365) * 100); // 12 months = full marks
      components.push({
        name: "Runway",
        score: Math.round(runwayScore),
        weight: 0.25,
        detail: `${cm.runwayDays} days of runway at current burn`,
        dataAvailable: true,
      });
    }

    // 4. Debt load — liabilities vs assets
    const assets = this.chart
      .ofType("ASSET")
      .reduce<Paise>((s, a) => add(s, this.ledger.balance(a.id, asOf)), ZERO);
    if (assets > 0n) {
      const debtPct = Number((liabilities * 100n) / assets);
      const debtScore = clamp(100 - debtPct); // 0% debt=100, 100% of assets=0
      components.push({
        name: "Debt",
        score: Math.round(debtScore),
        weight: 0.15,
        detail: `Liabilities are ${debtPct}% of assets`,
        dataAvailable: true,
      });
    } else {
      missing.push("Asset balances (debt load not scored)");
      components.push({ name: "Debt", score: 0, weight: 0, detail: "No assets recorded", dataAvailable: false });
    }

    // 5. Receivables discipline — how much of open AR is overdue (needs invoice engine)
    if (this.invoices) {
      const open = this.invoices
        .all()
        .filter((i) => (i.status === "SENT" || i.status === "PARTIALLY_PAID") && this.invoices!.outstanding(i) > 0n);
      if (open.length > 0) {
        const totalOpen = sum(open.map((i) => this.invoices!.outstanding(i)));
        const overdueAmt = sum(
          this.invoices.overdue(asOf).map((o) => o.outstanding),
        );
        const overduePct = totalOpen > 0n ? Number((overdueAmt * 100n) / totalOpen) : 0;
        components.push({
          name: "Receivables",
          score: Math.round(clamp(100 - overduePct)),
          weight: 0.1,
          detail: `${overduePct}% of open receivables are overdue`,
          dataAvailable: true,
        });
      } else {
        components.push({
          name: "Receivables",
          score: 100,
          weight: 0.1,
          detail: "No open receivables",
          dataAvailable: true,
        });
      }
    } else {
      missing.push("Invoice data (receivables discipline not scored)");
      components.push({ name: "Receivables", score: 0, weight: 0, detail: "Invoice engine not connected", dataAvailable: false });
    }

    // 6. Revenue growth — last full calendar month vs the month before it
    {
      const lastMonth = monthWindowBefore(asOf, 1);
      const monthBefore = monthWindowBefore(asOf, 2);
      const recent = this.statements.profitAndLoss(lastMonth.from, lastMonth.to).totalRevenue;
      const prior = this.statements.profitAndLoss(monthBefore.from, monthBefore.to).totalRevenue;
      if (prior > 0n && recent > 0n) {
        const growthPct = Number((sub(recent, prior) * 100n) / prior);
        components.push({
          name: "Revenue growth",
          score: Math.round(clamp(50 + growthPct * 2.5)), // flat = 50, +20% = 100, −20% = 0
          weight: 0.1,
          detail: `Revenue ${growthPct >= 0 ? "grew" : "shrank"} ${Math.abs(growthPct)}% month over month`,
          dataAvailable: true,
        });
      } else {
        missing.push("Two full months of revenue (growth not scored)");
        components.push({ name: "Revenue growth", score: 0, weight: 0, detail: "Insufficient revenue history", dataAvailable: false });
      }
    }

    // Re-normalize weights across available components.
    const available = components.filter((c) => c.dataAvailable);
    const totalWeight = available.reduce((s, c) => s + c.weight, 0);
    const score =
      totalWeight > 0
        ? Math.round(available.reduce((s, c) => s + c.score * (c.weight / totalWeight), 0))
        : 0;

    const grade =
      score >= 85 ? "Excellent" : score >= 70 ? "Good" : score >= 50 ? "Fair" : score >= 30 ? "Poor" : "Critical";

    return { asOf, score, grade, components, missing };
  }
}

/** First/last day of the calendar month `monthsBack` before asOf's month. */
const monthWindowBefore = (asOf: string, monthsBack: number): { from: string; to: string } => {
  const [y, m] = asOf.split("-").map(Number) as [number, number];
  const total = y * 12 + (m - 1) - monthsBack;
  const ty = Math.floor(total / 12);
  const tm = ((total % 12) + 12) % 12;
  const lastDay = new Date(Date.UTC(ty, tm + 1, 0)).getUTCDate();
  const mm = String(tm + 1).padStart(2, "0");
  return { from: `${ty}-${mm}-01`, to: `${ty}-${mm}-${String(lastDay).padStart(2, "0")}` };
};

const safeBalance = (ledger: Ledger, accountId: string, asOf: string): Paise => {
  try {
    return ledger.balance(accountId, asOf);
  } catch {
    return ZERO;
  }
};
