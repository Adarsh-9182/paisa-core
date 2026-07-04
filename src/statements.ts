/**
 * Financial Statements — Balance Sheet, Profit & Loss, Cash Flow.
 * Pure functions over the ledger. If the trial balance does not balance,
 * statement generation is blocked (Golden Rule: a delayed report is
 * acceptable; an incorrect one is not).
 */

import { Paise, ZERO, add, sub, neg } from "./money.js";
import { AccountType, ChartOfAccounts } from "./accounts.js";
import { Ledger } from "./ledger.js";
import { JournalEngine } from "./journal.js";

export class StatementError extends Error {
  override name = "StatementError";
}

export interface StatementLine {
  readonly accountId: string;
  readonly name: string;
  readonly amount: Paise;
}

export interface BalanceSheet {
  readonly asOf: string;
  readonly assets: readonly StatementLine[];
  readonly liabilities: readonly StatementLine[];
  readonly equity: readonly StatementLine[];
  readonly totalAssets: Paise;
  readonly totalLiabilities: Paise;
  readonly totalEquity: Paise; // includes current-period retained profit
  readonly equationHolds: boolean; // Assets = Liabilities + Equity
}

export interface ProfitAndLoss {
  readonly from: string;
  readonly to: string;
  readonly revenue: readonly StatementLine[];
  readonly expenses: readonly StatementLine[];
  readonly totalRevenue: Paise;
  readonly totalExpenses: Paise;
  readonly netProfit: Paise;
}

export interface CashFlowStatement {
  readonly from: string;
  readonly to: string;
  readonly openingCash: Paise;
  readonly closingCash: Paise;
  readonly netChange: Paise;
  readonly inflows: Paise;
  readonly outflows: Paise; // positive number representing cash out
}

export class Statements {
  constructor(
    private chart: ChartOfAccounts,
    private ledger: Ledger,
    private journal: JournalEngine,
  ) {}

  private assertBalanced(asOf: string): void {
    const tb = this.ledger.trialBalance(asOf);
    if (!tb.balanced)
      throw new StatementError(
        `Trial balance imbalanced as of ${asOf} (Dr ${tb.totalDebit} vs Cr ${tb.totalCredit}); statements blocked until resolved`,
      );
  }

  private linesOf(type: AccountType, asOf: string): StatementLine[] {
    return this.chart
      .ofType(type)
      .map((a) => ({ accountId: a.id, name: a.name, amount: this.ledger.balance(a.id, asOf) }))
      .filter((l) => l.amount !== 0n);
  }

  balanceSheet(asOf: string): BalanceSheet {
    this.assertBalanced(asOf);
    const assets = this.linesOf("ASSET", asOf);
    const liabilities = this.linesOf("LIABILITY", asOf);
    const equityLines = this.linesOf("EQUITY", asOf);

    const totalAssets = assets.reduce<Paise>((s, l) => add(s, l.amount), ZERO);
    const totalLiabilities = liabilities.reduce<Paise>((s, l) => add(s, l.amount), ZERO);
    const explicitEquity = equityLines.reduce<Paise>((s, l) => add(s, l.amount), ZERO);

    // Current-period profit not yet closed to retained earnings.
    const revenue = this.linesOf("REVENUE", asOf).reduce<Paise>((s, l) => add(s, l.amount), ZERO);
    const expenses = this.linesOf("EXPENSE", asOf).reduce<Paise>((s, l) => add(s, l.amount), ZERO);
    const periodProfit = sub(revenue, expenses);

    const totalEquity = add(explicitEquity, periodProfit);
    return {
      asOf,
      assets,
      liabilities,
      equity: equityLines,
      totalAssets,
      totalLiabilities,
      totalEquity,
      equationHolds: totalAssets === add(totalLiabilities, totalEquity),
    };
  }

  profitAndLoss(from: string, to: string): ProfitAndLoss {
    this.assertBalanced(to);
    const at = (type: AccountType, accountId: string): Paise =>
      sub(this.ledger.balance(accountId, to), this.ledger.balance(accountId, dayBefore(from)));
    const revenue = this.chart
      .ofType("REVENUE")
      .map((a) => ({ accountId: a.id, name: a.name, amount: at("REVENUE", a.id) }))
      .filter((l) => l.amount !== 0n);
    const expenses = this.chart
      .ofType("EXPENSE")
      .map((a) => ({ accountId: a.id, name: a.name, amount: at("EXPENSE", a.id) }))
      .filter((l) => l.amount !== 0n);
    const totalRevenue = revenue.reduce<Paise>((s, l) => add(s, l.amount), ZERO);
    const totalExpenses = expenses.reduce<Paise>((s, l) => add(s, l.amount), ZERO);
    return { from, to, revenue, expenses, totalRevenue, totalExpenses, netProfit: sub(totalRevenue, totalExpenses) };
  }

  cashFlow(from: string, to: string): CashFlowStatement {
    this.assertBalanced(to);
    const cashAccounts = this.chart.all().filter((a) => a.isCashEquivalent);
    let opening: Paise = ZERO;
    let closing: Paise = ZERO;
    let inflows: Paise = ZERO;
    let outflows: Paise = ZERO;

    for (const a of cashAccounts) {
      opening = add(opening, this.ledger.balance(a.id, dayBefore(from)));
      closing = add(closing, this.ledger.balance(a.id, to));
    }
    for (const e of this.journal.between(from, to)) {
      for (const l of e.lines) {
        const acct = this.chart.get(l.accountId);
        if (!acct.isCashEquivalent) continue;
        if (l.side === "DEBIT") inflows = add(inflows, l.amount);
        else outflows = add(outflows, l.amount);
      }
    }
    return { from, to, openingCash: opening, closingCash: closing, netChange: sub(closing, opening), inflows, outflows };
  }
}

const dayBefore = (iso: string): string => {
  const d = new Date(iso + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
};
