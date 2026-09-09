/**
 * Budgets — the plan the books get measured against.
 *
 * One number per account per period, entered by a human. There is no
 * inference here: a budget nobody typed is not a budget, and an account with
 * no budget is silent rather than assumed to be zero. That distinction is the
 * whole reason this module exists separately from the ledger — "we planned
 * ₹0" and "we never planned this line" produce very different alerts, and
 * conflating them is how a budget report turns into noise people stop reading.
 *
 * This module owns *budget policy*: what a budget is, and how far actuals
 * have to drift before the drift is worth someone's attention. It deliberately
 * does not answer the close checklist's materiality question (`close.flux`) —
 * that is a different question about period-over-period movement, and the two
 * are allowed to have different thresholds precisely because they are not the
 * same question. What must never happen is two answers to *one* question.
 *
 * Sign convention: budgets are stored as positive magnitudes, in the same
 * direction the P&L reports the account. Whether a variance is bad depends on
 * the account type, not on the sign — overspending an expense and missing a
 * revenue target are both unfavourable, and they move opposite ways.
 */

import { Paise, ZERO, sub, abs, cmp, sum } from "../money.js";
import { EventBus } from "../events.js";
import { PeriodKey } from "./periods.js";

export class BudgetError extends Error {
  override name = "BudgetError";
}

export type BudgetAccountType = "REVENUE" | "EXPENSE";

export interface BudgetLineIn {
  readonly accountId: string;
  /** Positive magnitude, in the direction the P&L reports this account. */
  readonly amount: Paise;
}

export interface Budget {
  readonly period: PeriodKey;
  readonly accountId: string;
  readonly amount: Paise;
  readonly setBy: string;
  readonly setAt: string;
}

/** An actual, as the P&L reports it — supplied, never recomputed here. */
export interface ActualLine {
  readonly accountId: string;
  readonly name: string;
  readonly type: BudgetAccountType;
  /** Positive magnitude, matching the budget's direction. */
  readonly amount: Paise;
}

/**
 * The account as the chart knows it.
 *
 * Asked for separately from the actuals because the P&L only lists accounts
 * that moved: a revenue line budgeted at ₹6,00,000 that earned nothing is
 * absent from it entirely. Reading the name and direction off that missing
 * row reported a total revenue miss as a saving, under an account id.
 */
export type AccountLookup = (accountId: string) => { readonly name: string; readonly type: BudgetAccountType };

export interface VarianceLine {
  readonly accountId: string;
  readonly name: string;
  readonly type: BudgetAccountType;
  readonly budget: Paise;
  readonly actual: Paise;
  /** actual − budget, signed. Read it with `unfavourable`, not on its own. */
  readonly variance: Paise;
  /** Variance as basis points of budget; null when the budget is zero. */
  readonly varianceBps: number | null;
  /** Over on an expense, or short on revenue. */
  readonly unfavourable: boolean;
  /** Past this module's thresholds — the ones worth raising. */
  readonly breach: boolean;
}

export interface VarianceReport {
  readonly period: PeriodKey;
  readonly lines: readonly VarianceLine[];
  readonly budgetedTotal: Paise;
  readonly actualTotal: Paise;
}

export interface BudgetThresholds {
  /** Below this, a variance is rounding, not a decision. */
  readonly floor: Paise;
  /** And it must also be off by at least this share of the budget. */
  readonly bps: number;
}

const DEFAULT_THRESHOLDS: BudgetThresholds = {
  floor: 2500000n as Paise, // ₹25,000
  bps: 2000, // 20%
};

export class BudgetEngine {
  /** Keyed `period|accountId` — one budget per account per period. */
  private budgets = new Map<string, Budget>();

  constructor(
    public readonly orgId: string,
    private bus: EventBus,
    /**
     * Rejects an account that cannot carry a budget, at the moment someone
     * types it. Without it the complaint arrives at report time, pointed at
     * whoever opened the page rather than whoever set the number.
     */
    private account: AccountLookup,
    private thresholds: BudgetThresholds = DEFAULT_THRESHOLDS,
  ) {}

  private static key(period: PeriodKey, accountId: string): string {
    return `${period}|${accountId}`;
  }

  /**
   * Set the budget for one or more accounts in a period. Re-setting an
   * account replaces its number: a budget is a current intention, not a log,
   * and the event stream already carries who changed what and when.
   */
  set(period: PeriodKey, lines: readonly BudgetLineIn[], actor: string): readonly Budget[] {
    if (lines.length === 0) throw new BudgetError("a budget needs at least one line");
    for (const line of lines) {
      this.account(line.accountId);
      if (cmp(line.amount, ZERO) < 0) {
        throw new BudgetError(
          `budget for ${line.accountId} is negative — budgets are magnitudes in the account's own direction`,
        );
      }
    }

    const setAt = new Date().toISOString();
    const saved = lines.map((line) => {
      const budget: Budget = { period, accountId: line.accountId, amount: line.amount, setBy: actor, setAt };
      this.budgets.set(BudgetEngine.key(period, line.accountId), budget);
      return budget;
    });

    this.bus.emit({
      orgId: this.orgId,
      type: "budget.set",
      at: setAt,
      actor,
      payload: { period, accounts: saved.length, total: sum(saved.map((b) => b.amount)).toString() },
    });
    return saved;
  }

  /** The budget for one account, or null when nobody set one. */
  get(period: PeriodKey, accountId: string): Budget | null {
    return this.budgets.get(BudgetEngine.key(period, accountId)) ?? null;
  }

  /** Every budget set for a period. */
  forPeriod(period: PeriodKey): readonly Budget[] {
    return [...this.budgets.values()].filter((b) => b.period === period);
  }

  /**
   * Budget against actuals for a period.
   *
   * Only budgeted accounts appear. An account nobody budgeted has no plan to
   * be measured against, so reporting it as "100% over" would be a statement
   * about our data, not about the business.
   */
  variance(period: PeriodKey, actuals: readonly ActualLine[]): VarianceReport {
    const byAccount = new Map(actuals.map((a) => [a.accountId, a]));

    const lines = this.forPeriod(period)
      .map((budget) => {
        const actualLine = byAccount.get(budget.accountId);
        // Budgeted and then never spent is itself a variance worth seeing,
        // so a missing actual reads as zero rather than dropping the line.
        const actual = actualLine?.amount ?? ZERO;
        const { name, type } = this.account(budget.accountId);
        const variance = sub(actual, budget.amount);
        const over = cmp(variance, ZERO) > 0;
        const unfavourable = type === "REVENUE" ? cmp(variance, ZERO) < 0 : over;

        const varianceBps =
          budget.amount === ZERO
            ? null
            : Number((abs(variance) * 10000n) / budget.amount);

        return {
          accountId: budget.accountId,
          name,
          type,
          budget: budget.amount,
          actual,
          variance,
          varianceBps,
          unfavourable,
          breach: unfavourable && this.breaches(abs(variance), varianceBps),
        };
      })
      .sort((a, b) => cmp(abs(b.variance), abs(a.variance)));

    return {
      period,
      lines,
      budgetedTotal: sum(lines.map((l) => l.budget)),
      actualTotal: sum(lines.map((l) => l.actual)),
    };
  }

  /**
   * Both tests, not either: a large percentage of a small budget is noise,
   * and a large rupee number against a large budget is a rounding error at
   * that scale. Only the overlap deserves an interruption.
   *
   * A zero budget has no percentage to test, so the rupee floor decides —
   * spending against a line planned at zero is exactly the surprise this is
   * meant to catch.
   */
  private breaches(magnitude: Paise, varianceBps: number | null): boolean {
    if (cmp(magnitude, this.thresholds.floor) < 0) return false;
    return varianceBps === null || varianceBps >= this.thresholds.bps;
  }
}
