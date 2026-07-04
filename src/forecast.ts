/**
 * Forecast Engine — deterministic projections, honestly labelled.
 *
 * History is read straight off the ledger month by month. The forecast is a
 * stated model (trailing-average net burn extrapolated forward), never a
 * guess dressed up as knowledge: every projection carries the assumption it
 * was computed under, and with no history the engine declines to project.
 */

import { Paise, ZERO, add, sub, mulRatio } from "./money.js";
import { Statements } from "./statements.js";
import { CashFlowIntelligence } from "./cashflow.js";

export interface MonthlyCashPoint {
  readonly month: string; // "2026-06"
  readonly inflows: Paise;
  readonly outflows: Paise;
  readonly net: Paise;
  readonly closingCash: Paise;
  readonly kind: "actual" | "forecast";
}

export interface CashForecast {
  readonly asOf: string;
  readonly points: readonly MonthlyCashPoint[]; // history then projection, oldest first
  readonly assumption: string;
  readonly depletionMonth: string | null; // first projected month cash goes ≤ 0, if burning
}

export interface ScenarioInput {
  readonly label: string;
  readonly monthlyRevenueDelta?: Paise; // e.g. new client +₹1L/mo
  readonly monthlyExpenseDelta?: Paise; // e.g. new hire +₹80k/mo
  readonly oneTimeCost?: Paise; // e.g. equipment purchase
}

export interface ScenarioResult {
  readonly label: string;
  readonly baselineBurn: Paise | null;
  readonly scenarioBurn: Paise;
  readonly cashNow: Paise;
  readonly cashAfterOneTime: Paise;
  readonly baselineRunwayDays: number | null;
  readonly scenarioRunwayDays: number | null; // null = cash-flow positive under scenario
  readonly verdict: string;
}

export class ForecastError extends Error {
  override name = "ForecastError";
}

export class ForecastEngine {
  constructor(
    private statements: Statements,
    private cashflow: CashFlowIntelligence,
  ) {}

  /** Actual monthly cash movement for the trailing `months` calendar months ending in asOf's month. */
  monthlyHistory(asOf: string, months = 6): readonly MonthlyCashPoint[] {
    const out: MonthlyCashPoint[] = [];
    for (let i = months - 1; i >= 0; i--) {
      const { from, to } = monthWindow(asOf, -i);
      const end = to <= asOf ? to : asOf; // current month runs only up to asOf
      const cf = this.statements.cashFlow(from, end);
      out.push({
        month: from.slice(0, 7),
        inflows: cf.inflows,
        outflows: cf.outflows,
        net: cf.netChange,
        closingCash: cf.closingCash,
        kind: "actual",
      });
    }
    return out;
  }

  /** History plus `monthsAhead` projected months at the trailing-average net burn. */
  cashForecast(asOf: string, historyMonths = 6, monthsAhead = 3): CashForecast {
    const history = this.monthlyHistory(asOf, historyMonths);
    const metrics = this.cashflow.metrics(asOf);

    if (metrics.monthlyNetBurn === null) {
      return {
        asOf,
        points: history,
        assumption: "Insufficient transaction history to project forward; showing actuals only.",
        depletionMonth: null,
      };
    }

    const burn = metrics.monthlyNetBurn; // positive = cash shrinking
    const points = [...history];
    let cash = metrics.cashOnHand;
    let depletionMonth: string | null = null;
    for (let i = 1; i <= monthsAhead; i++) {
      const { from } = monthWindow(asOf, i);
      cash = sub(cash, burn);
      const month = from.slice(0, 7);
      if (cash <= 0n && depletionMonth === null && burn > 0n) depletionMonth = month;
      points.push({
        month,
        inflows: ZERO,
        outflows: ZERO,
        net: sub(ZERO, burn),
        closingCash: cash,
        kind: "forecast",
      });
    }
    return {
      asOf,
      points,
      assumption: `Projection holds net cash movement constant at the trailing ${metrics.basisMonths}-month average.`,
      depletionMonth,
    };
  }

  /** What happens to burn and runway if revenue/expenses change or a one-time cost lands. */
  scenario(asOf: string, input: ScenarioInput): ScenarioResult {
    const metrics = this.cashflow.metrics(asOf);
    const revDelta = input.monthlyRevenueDelta ?? ZERO;
    const expDelta = input.monthlyExpenseDelta ?? ZERO;
    const oneTime = input.oneTimeCost ?? ZERO;

    const baselineBurn = metrics.monthlyNetBurn;
    // scenario burn = baseline burn + expense delta − revenue delta (baseline 0 if no history)
    const scenarioBurn = add(sub(baselineBurn ?? ZERO, revDelta), expDelta);
    const cashAfterOneTime = sub(metrics.cashOnHand, oneTime);

    const scenarioRunwayDays =
      scenarioBurn > 0n && cashAfterOneTime > 0n
        ? Number((cashAfterOneTime * 30n) / scenarioBurn)
        : scenarioBurn > 0n
          ? 0
          : null;

    let verdict: string;
    if (cashAfterOneTime <= 0n) {
      verdict = `Not affordable: the one-time cost exceeds available cash.`;
    } else if (scenarioRunwayDays === null) {
      verdict =
        baselineBurn === null
          ? `No burn history; under the scenario cash flow is non-negative, but the baseline is unverified.`
          : `Affordable: the business stays cash-flow positive under "${input.label}".`;
    } else if (scenarioRunwayDays >= 365) {
      verdict = `Affordable with margin: projected runway stays above 12 months.`;
    } else if (scenarioRunwayDays >= 180) {
      verdict = `Affordable but watch it: projected runway falls to ${scenarioRunwayDays} days.`;
    } else {
      verdict = `Risky: projected runway drops to ${scenarioRunwayDays} days, under the 6-month safety floor.`;
    }

    return {
      label: input.label,
      baselineBurn,
      scenarioBurn,
      cashNow: metrics.cashOnHand,
      cashAfterOneTime,
      baselineRunwayDays: metrics.runwayDays,
      scenarioRunwayDays,
      verdict,
    };
  }
}

/** First and last day of the calendar month `offset` months away from asOf's month. */
const monthWindow = (asOf: string, offset: number): { from: string; to: string } => {
  const [y, m] = asOf.split("-").map(Number) as [number, number];
  const total = y * 12 + (m - 1) + offset;
  const ty = Math.floor(total / 12);
  const tm = ((total % 12) + 12) % 12;
  const lastDay = new Date(Date.UTC(ty, tm + 1, 0)).getUTCDate();
  const mm = String(tm + 1).padStart(2, "0");
  return { from: `${ty}-${mm}-01`, to: `${ty}-${mm}-${String(lastDay).padStart(2, "0")}` };
};
