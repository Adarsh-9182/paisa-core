/**
 * Cash Flow Intelligence — burn rate, runway, net position.
 * Deterministic, derived exclusively from the ledger. When data is
 * insufficient, the engine says so instead of guessing.
 */

import { Paise, ZERO, add, sub, mulRatio } from "./money.js";
import { ChartOfAccounts } from "./accounts.js";
import { Statements } from "./statements.js";
import { Ledger } from "./ledger.js";

export interface CashMetrics {
  readonly asOf: string;
  readonly cashOnHand: Paise;
  readonly monthlyNetBurn: Paise | null; // positive = burning cash; null if insufficient history
  readonly runwayDays: number | null; // null = insufficient data or not burning
  readonly basisMonths: number;
  readonly note: string;
}

export class CashFlowIntelligence {
  constructor(
    private chart: ChartOfAccounts,
    private ledger: Ledger,
    private statements: Statements,
  ) {}

  cashOnHand(asOf: string): Paise {
    return this.chart
      .all()
      .filter((a) => a.isCashEquivalent)
      .reduce<Paise>((s, a) => add(s, this.ledger.balance(a.id, asOf)), ZERO);
  }

  /** Trailing-N-month metrics ending at asOf (default 3 months). */
  metrics(asOf: string, basisMonths = 3): CashMetrics {
    const cash = this.cashOnHand(asOf);
    const from = monthsBefore(asOf, basisMonths);
    const cf = this.statements.cashFlow(from, asOf);
    const netChange = cf.netChange;

    if (cf.inflows === 0n && cf.outflows === 0n) {
      return {
        asOf,
        cashOnHand: cash,
        monthlyNetBurn: null,
        runwayDays: null,
        basisMonths,
        note: "Insufficient transaction history in the basis window; burn and runway not computed.",
      };
    }

    // monthly net burn = -(net change) / months; positive means cash is shrinking
    const monthlyNetBurn = mulRatio(sub(ZERO, netChange), 1n, BigInt(basisMonths));

    if (monthlyNetBurn <= 0n) {
      return {
        asOf,
        cashOnHand: cash,
        monthlyNetBurn,
        runwayDays: null,
        basisMonths,
        note: "Cash-flow positive over the basis window; runway is not a binding constraint.",
      };
    }

    // runwayDays = cash * 30 / monthlyNetBurn — computed in bigint, no intermediate rounding
    const runwayDays = monthlyNetBurn > 0n ? Number((cash * 30n) / monthlyNetBurn) : null;
    return {
      asOf,
      cashOnHand: cash,
      monthlyNetBurn,
      runwayDays,
      basisMonths,
      note: `Computed from ${basisMonths} months of ledger history ending ${asOf}.`,
    };
  }
}

/**
 * Subtract calendar months without overflowing into the next month when the
 * target month is shorter (e.g. 2026-05-31 minus 3 months must land on
 * 2026-02-28, not roll over to 2026-03-03).
 */
const monthsBefore = (iso: string, months: number): string => {
  const [y, m, d] = iso.split("-").map(Number) as [number, number, number];
  const total = y * 12 + (m - 1) - months;
  const targetYear = Math.floor(total / 12);
  const targetMonth = ((total % 12) + 12) % 12; // 0-indexed, always positive
  const lastDayOfTargetMonth = new Date(Date.UTC(targetYear, targetMonth + 1, 0)).getUTCDate();
  const day = Math.min(d, lastDayOfTargetMonth);
  return `${targetYear}-${String(targetMonth + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
};
