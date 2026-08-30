/**
 * Recurring close mechanics: accruals, prepaid amortisation, depreciation.
 *
 * All three are the same shape — a schedule computed once, then posted one
 * period at a time, idempotently. Running a period twice posts once, which
 * is what makes an automated close safe to re-run after a correction.
 *
 * Accruals auto-reverse on the first day of the following period, which is
 * the standard treatment: the estimate is backed out when the real invoice
 * arrives, so an accrual can never double-count an expense.
 *
 * Straight-line only, deliberately. Every schedule sums exactly to the
 * amount being spread, with the rounding remainder on the final period.
 */

import { Paise, ZERO, add, sub, sum, mulRatio } from "../money.js";
import { JournalEngine } from "../journal.js";
import { EventBus } from "../events.js";
import { PeriodKey, periodOf, periodEnd, periodStart, periodRange, nextPeriod } from "./periods.js";

export class ScheduleError extends Error {
  override name = "ScheduleError";
}

export interface SchedulePeriodAmount {
  readonly period: PeriodKey;
  readonly amount: Paise;
}

/** Split an amount straight-line across periods; remainder on the last. */
export const straightLine = (
  amount: Paise,
  fromPeriod: PeriodKey,
  toPeriod: PeriodKey,
): readonly SchedulePeriodAmount[] => {
  const periods = periodRange(fromPeriod, toPeriod);
  if (periods.length === 0) throw new ScheduleError(`Empty period range ${fromPeriod}..${toPeriod}`);
  const per = mulRatio(amount, 1n, BigInt(periods.length));
  const amounts = periods.map(() => per);
  amounts[amounts.length - 1] = add(amounts[amounts.length - 1]!, sub(amount, sum(amounts)));
  return periods.map((period, i) => ({ period, amount: amounts[i]! }));
};

/* ------------------------------------------------------------------ */
/* Accruals                                                            */
/* ------------------------------------------------------------------ */

export interface Accrual {
  readonly id: string;
  readonly description: string;
  readonly period: PeriodKey;
  readonly amount: Paise;
  readonly expenseAccountId: string;
  readonly liabilityAccountId: string;
  readonly journalEntryId: string;
  /** The auto-reversal posted into the following period. */
  readonly reversalEntryId: string;
  readonly createdBy: string;
}

/* ------------------------------------------------------------------ */
/* Prepaid expenses                                                    */
/* ------------------------------------------------------------------ */

export interface Prepaid {
  readonly id: string;
  readonly description: string;
  readonly total: Paise;
  readonly startPeriod: PeriodKey;
  readonly endPeriod: PeriodKey;
  readonly expenseAccountId: string;
  readonly prepaidAccountId: string;
  readonly schedule: readonly SchedulePeriodAmount[];
  /** period → journal entry id, for the periods already amortised. */
  readonly posted: ReadonlyMap<PeriodKey, string>;
}

/* ------------------------------------------------------------------ */
/* Fixed assets                                                        */
/* ------------------------------------------------------------------ */

export interface FixedAsset {
  readonly id: string;
  readonly name: string;
  readonly cost: Paise;
  readonly salvageValue: Paise;
  readonly inServicePeriod: PeriodKey;
  readonly usefulLifeMonths: number;
  readonly assetAccountId: string;
  readonly schedule: readonly SchedulePeriodAmount[];
  readonly posted: ReadonlyMap<PeriodKey, string>;
  readonly disposedPeriod: PeriodKey | null;
}

export interface RunResult {
  readonly period: PeriodKey;
  readonly journalEntryId: string | null;
  readonly amount: Paise;
  readonly itemCount: number;
}

export class ScheduleEngine {
  private accruals = new Map<string, Accrual>();
  private prepaids = new Map<string, Prepaid>();
  private assets = new Map<string, FixedAsset>();
  private counter = 0;

  constructor(
    public readonly orgId: string,
    private journal: JournalEngine,
    private bus: EventBus,
    private accounts = {
      prepaid: "acc_prepaid",
      accruedLiabilities: "acc_accrued_liabilities",
      accumulatedDepreciation: "acc_accum_depreciation",
      depreciationExpense: "acc_depreciation_expense",
      amortizationExpense: "acc_amortization_expense",
    },
  ) {}

  /* -------------------------------------------------------------- */

  /**
   * Accrue an estimated expense at period end and back it out on day one
   * of the next period. Both entries post immediately — the reversal is
   * not a promise to remember later, it is already in the ledger.
   */
  accrue(
    input: {
      description: string;
      period: PeriodKey;
      amount: Paise;
      expenseAccountId: string;
      liabilityAccountId?: string;
    },
    actor: string,
  ): Accrual {
    if (input.amount <= 0n) throw new ScheduleError("Accrual amount must be positive");
    const liabilityAccountId = input.liabilityAccountId ?? this.accounts.accruedLiabilities;
    const id = `acr_${this.orgId}_${++this.counter}`;

    const entry = this.journal.post({
      date: periodEnd(input.period),
      narration: `Accrual — ${input.description} (${input.period})`,
      lines: [
        { accountId: input.expenseAccountId, side: "DEBIT", amount: input.amount },
        { accountId: liabilityAccountId, side: "CREDIT", amount: input.amount },
      ],
      sourceModule: "accrual",
      referenceId: id,
      createdBy: actor,
    });

    const reversal = this.journal.post({
      date: periodStart(nextPeriod(input.period)),
      narration: `Accrual reversal — ${input.description} (${input.period})`,
      lines: [
        { accountId: liabilityAccountId, side: "DEBIT", amount: input.amount },
        { accountId: input.expenseAccountId, side: "CREDIT", amount: input.amount },
      ],
      sourceModule: "accrual",
      referenceId: id,
      createdBy: actor,
    });

    const accrual: Accrual = {
      id,
      description: input.description,
      period: input.period,
      amount: input.amount,
      expenseAccountId: input.expenseAccountId,
      liabilityAccountId,
      journalEntryId: entry.id,
      reversalEntryId: reversal.id,
      createdBy: actor,
    };
    this.accruals.set(id, accrual);
    this.emit("accrual.posted", actor, {
      accrualId: id,
      period: input.period,
      amount: input.amount.toString(),
      entryId: entry.id,
      reversalId: reversal.id,
    });
    return accrual;
  }

  allAccruals(): readonly Accrual[] {
    return [...this.accruals.values()];
  }

  /* -------------------------------------------------------------- */

  /** Record a prepayment and build its amortisation schedule. */
  addPrepaid(
    input: {
      description: string;
      total: Paise;
      startPeriod: PeriodKey;
      endPeriod: PeriodKey;
      expenseAccountId: string;
      /** Where the cash came from; omit if the prepaid asset already exists. */
      fundingAccountId?: string;
      inceptionDate?: string;
    },
    actor: string,
  ): Prepaid {
    if (input.total <= 0n) throw new ScheduleError("Prepaid amount must be positive");
    if (input.endPeriod < input.startPeriod) throw new ScheduleError("Prepaid ends before it starts");
    const id = `ppd_${this.orgId}_${++this.counter}`;

    if (input.fundingAccountId) {
      this.journal.post({
        date: input.inceptionDate ?? periodStart(input.startPeriod),
        narration: `Prepaid — ${input.description}`,
        lines: [
          { accountId: this.accounts.prepaid, side: "DEBIT", amount: input.total },
          { accountId: input.fundingAccountId, side: "CREDIT", amount: input.total },
        ],
        sourceModule: "amortization",
        referenceId: id,
        createdBy: actor,
      });
    }

    const prepaid: Prepaid = {
      id,
      description: input.description,
      total: input.total,
      startPeriod: input.startPeriod,
      endPeriod: input.endPeriod,
      expenseAccountId: input.expenseAccountId,
      prepaidAccountId: this.accounts.prepaid,
      schedule: straightLine(input.total, input.startPeriod, input.endPeriod),
      posted: new Map(),
    };
    this.prepaids.set(id, prepaid);
    this.emit("prepaid.created", actor, { prepaidId: id, total: input.total.toString() });
    return prepaid;
  }

  /** Amortise every prepaid with an unposted instalment for the period. */
  runAmortization(period: PeriodKey, actor: string): RunResult {
    const due = [...this.prepaids.values()]
      .map((p) => ({ prepaid: p, cell: p.schedule.find((s) => s.period === period) }))
      .filter((x): x is { prepaid: Prepaid; cell: SchedulePeriodAmount } => !!x.cell && !x.prepaid.posted.has(period))
      .filter((x) => x.cell.amount > 0n);
    if (due.length === 0) return { period, journalEntryId: null, amount: ZERO, itemCount: 0 };

    const byExpense = new Map<string, Paise>();
    for (const d of due)
      byExpense.set(d.prepaid.expenseAccountId, add(byExpense.get(d.prepaid.expenseAccountId) ?? ZERO, d.cell.amount));
    const total = sum(due.map((d) => d.cell.amount));

    const entry = this.journal.post({
      date: periodEnd(period),
      narration: `Prepaid amortisation ${period} — ${due.length} item${due.length === 1 ? "" : "s"}`,
      lines: [
        ...[...byExpense.entries()].map(([accountId, amount]) => ({ accountId, side: "DEBIT" as const, amount })),
        { accountId: this.accounts.prepaid, side: "CREDIT" as const, amount: total },
      ],
      sourceModule: "amortization",
      referenceId: period,
      createdBy: actor,
    });

    for (const d of due) {
      const posted = new Map(d.prepaid.posted);
      posted.set(period, entry.id);
      this.prepaids.set(d.prepaid.id, { ...d.prepaid, posted });
    }
    this.emit("amortization.posted", actor, { period, amount: total.toString(), entryId: entry.id });
    return { period, journalEntryId: entry.id, amount: total, itemCount: due.length };
  }

  allPrepaids(): readonly Prepaid[] {
    return [...this.prepaids.values()];
  }

  /** Unamortised balance across all prepaids as of a period. */
  prepaidRemaining(asOfPeriod: PeriodKey): Paise {
    return sum(
      this.allPrepaids().flatMap((p) =>
        p.schedule.filter((s) => s.period > asOfPeriod || !p.posted.has(s.period)).map((s) => s.amount),
      ),
    );
  }

  /* -------------------------------------------------------------- */

  /** Capitalise an asset and build its straight-line depreciation schedule. */
  addAsset(
    input: {
      name: string;
      cost: Paise;
      salvageValue?: Paise;
      inServicePeriod: PeriodKey;
      usefulLifeMonths: number;
      assetAccountId: string;
      /** Where the cash came from; omit if the asset is already on the books. */
      fundingAccountId?: string;
    },
    actor: string,
  ): FixedAsset {
    if (input.cost <= 0n) throw new ScheduleError("Asset cost must be positive");
    if (input.usefulLifeMonths < 1) throw new ScheduleError("Useful life must be at least one month");
    const salvageValue = input.salvageValue ?? ZERO;
    if (salvageValue >= input.cost) throw new ScheduleError("Salvage value must be below cost");
    const id = `fa_${this.orgId}_${++this.counter}`;

    if (input.fundingAccountId) {
      this.journal.post({
        date: periodStart(input.inServicePeriod),
        narration: `Asset acquired — ${input.name}`,
        lines: [
          { accountId: input.assetAccountId, side: "DEBIT", amount: input.cost },
          { accountId: input.fundingAccountId, side: "CREDIT", amount: input.cost },
        ],
        sourceModule: "depreciation",
        referenceId: id,
        createdBy: actor,
      });
    }

    const endPeriod = periodRange(input.inServicePeriod, input.inServicePeriod).length
      ? addPeriods(input.inServicePeriod, input.usefulLifeMonths - 1)
      : input.inServicePeriod;

    const asset: FixedAsset = {
      id,
      name: input.name,
      cost: input.cost,
      salvageValue,
      inServicePeriod: input.inServicePeriod,
      usefulLifeMonths: input.usefulLifeMonths,
      assetAccountId: input.assetAccountId,
      schedule: straightLine(sub(input.cost, salvageValue), input.inServicePeriod, endPeriod),
      posted: new Map(),
      disposedPeriod: null,
    };
    this.assets.set(id, asset);
    this.emit("asset.capitalized", actor, { assetId: id, cost: input.cost.toString(), life: input.usefulLifeMonths });
    return asset;
  }

  /** Depreciate every in-service asset for the period. */
  runDepreciation(period: PeriodKey, actor: string): RunResult {
    const due = [...this.assets.values()]
      .filter((a) => a.disposedPeriod === null || period < a.disposedPeriod)
      .map((a) => ({ asset: a, cell: a.schedule.find((s) => s.period === period) }))
      .filter((x): x is { asset: FixedAsset; cell: SchedulePeriodAmount } => !!x.cell && !x.asset.posted.has(period))
      .filter((x) => x.cell.amount > 0n);
    if (due.length === 0) return { period, journalEntryId: null, amount: ZERO, itemCount: 0 };

    const total = sum(due.map((d) => d.cell.amount));
    const entry = this.journal.post({
      date: periodEnd(period),
      narration: `Depreciation ${period} — ${due.length} asset${due.length === 1 ? "" : "s"}`,
      lines: [
        { accountId: this.accounts.depreciationExpense, side: "DEBIT", amount: total },
        { accountId: this.accounts.accumulatedDepreciation, side: "CREDIT", amount: total },
      ],
      sourceModule: "depreciation",
      referenceId: period,
      createdBy: actor,
    });

    for (const d of due) {
      const posted = new Map(d.asset.posted);
      posted.set(period, entry.id);
      this.assets.set(d.asset.id, { ...d.asset, posted });
    }
    this.emit("depreciation.posted", actor, { period, amount: total.toString(), entryId: entry.id });
    return { period, journalEntryId: entry.id, amount: total, itemCount: due.length };
  }

  /** Net book value of an asset after the periods depreciated so far. */
  netBookValue(assetId: string): Paise {
    const a = this.getAsset(assetId);
    const depreciated = sum(a.schedule.filter((s) => a.posted.has(s.period)).map((s) => s.amount));
    return sub(a.cost, depreciated);
  }

  getAsset(assetId: string): FixedAsset {
    const a = this.assets.get(assetId);
    if (!a) throw new ScheduleError(`Unknown asset ${assetId}`);
    return a;
  }

  allAssets(): readonly FixedAsset[] {
    return [...this.assets.values()];
  }

  private emit(type: string, actor: string, payload: Record<string, unknown>): void {
    this.bus.emit({ orgId: this.orgId, type, at: new Date().toISOString(), actor, payload });
  }
}

const addPeriods = (p: PeriodKey, n: number): PeriodKey => {
  let cur = p;
  for (let i = 0; i < n; i++) cur = nextPeriod(cur);
  return cur;
};
