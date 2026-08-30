/**
 * Multi-currency: transaction-date translation and period-end revaluation.
 *
 * Rates are stored as exact rationals (num/den), never floats, so a
 * conversion is reproducible to the paisa and an auditor re-running it
 * gets the same answer. There is no rate interpolation and no "latest
 * rate" fallback: if the rate for a date was never loaded, conversion
 * fails loudly rather than silently using a stale number.
 *
 * Monetary balances (cash, AR, AP) held in a foreign currency are
 * revalued at each period end; the delta hits FX gain or loss. Non-
 * monetary balances are never revalued, which is why revaluation is
 * opt-in per account rather than applied to the whole trial balance.
 */

import { Paise, ZERO, sub, mulRatio } from "../money.js";
import { JournalEngine } from "../journal.js";
import { EventBus } from "../events.js";
import { PeriodKey, periodEnd } from "./periods.js";

export class FxError extends Error {
  override name = "FxError";
}

export interface FxRate {
  readonly currency: string;
  readonly date: string;
  /** 1 unit of `currency` = num/den units of the functional currency. */
  readonly num: bigint;
  readonly den: bigint;
}

export interface RevaluationLine {
  readonly accountId: string;
  readonly currency: string;
  readonly foreignBalance: Paise;
  readonly bookedFunctional: Paise;
  readonly revaluedFunctional: Paise;
  readonly delta: Paise; // positive = gain
}

export interface RevaluationResult {
  readonly period: PeriodKey;
  readonly lines: readonly RevaluationLine[];
  readonly netGain: Paise;
  readonly journalEntryId: string | null;
}

export class FxEngine {
  private rates = new Map<string, FxRate>(); // "CUR|YYYY-MM-DD"
  /** Accounts carrying a foreign-currency monetary balance. */
  private monetary = new Map<string, string>(); // accountId -> currency
  private revalued = new Set<PeriodKey>();

  constructor(
    public readonly orgId: string,
    public readonly functionalCurrency: string,
    private journal: JournalEngine,
    private bus: EventBus,
    private accounts = { gain: "acc_fx_gain", loss: "acc_fx_loss" },
  ) {}

  /** Load a rate. Rationals only — pass 8350n/100n for ₹83.50 per USD. */
  setRate(currency: string, date: string, num: bigint, den: bigint): FxRate {
    if (den === 0n) throw new FxError("Rate denominator cannot be zero");
    if (num <= 0n) throw new FxError("Rate must be positive");
    if (currency === this.functionalCurrency)
      throw new FxError(`${currency} is the functional currency; it needs no rate`);
    const rate: FxRate = { currency, date, num, den };
    this.rates.set(`${currency}|${date}`, rate);
    return rate;
  }

  rate(currency: string, date: string): FxRate {
    if (currency === this.functionalCurrency) return { currency, date, num: 1n, den: 1n };
    const r = this.rates.get(`${currency}|${date}`);
    if (!r)
      throw new FxError(
        `No ${currency} rate loaded for ${date}. Paisa will not guess or carry forward a stale rate.`,
      );
    return r;
  }

  /** Foreign amount → functional currency at the given date's rate. */
  convert(amount: Paise, currency: string, date: string): Paise {
    const r = this.rate(currency, date);
    return mulRatio(amount, r.num, r.den);
  }

  /** Flag an account as holding a foreign-currency monetary balance. */
  markMonetary(accountId: string, currency: string): void {
    if (currency === this.functionalCurrency)
      throw new FxError(`${accountId} is in the functional currency; it is not exposed to FX`);
    this.monetary.set(accountId, currency);
  }

  monetaryAccounts(): readonly { accountId: string; currency: string }[] {
    return [...this.monetary.entries()].map(([accountId, currency]) => ({ accountId, currency }));
  }

  /**
   * Period-end revaluation. `foreignBalanceOf` supplies the balance in its
   * own currency and `bookedFunctionalOf` what the ledger currently carries;
   * the difference is the unrealised gain or loss.
   */
  revalue(
    period: PeriodKey,
    actor: string,
    foreignBalanceOf: (accountId: string) => Paise,
    bookedFunctionalOf: (accountId: string) => Paise,
  ): RevaluationResult {
    if (this.revalued.has(period))
      return { period, lines: [], netGain: ZERO, journalEntryId: null };
    const date = periodEnd(period);
    const lines: RevaluationLine[] = [];
    let netGain: Paise = ZERO;

    for (const { accountId, currency } of this.monetaryAccounts()) {
      const foreignBalance = foreignBalanceOf(accountId);
      if (foreignBalance === ZERO) continue;
      const bookedFunctional = bookedFunctionalOf(accountId);
      const revaluedFunctional = this.convert(foreignBalance, currency, date);
      const delta = sub(revaluedFunctional, bookedFunctional);
      if (delta === ZERO) continue;
      lines.push({ accountId, currency, foreignBalance, bookedFunctional, revaluedFunctional, delta });
      netGain = (netGain + delta) as Paise;
    }

    if (lines.length === 0) {
      this.revalued.add(period);
      return { period, lines, netGain: ZERO, journalEntryId: null };
    }

    const entryLines = [
      ...lines.map((l) => ({
        accountId: l.accountId,
        side: (l.delta > 0n ? "DEBIT" : "CREDIT") as "DEBIT" | "CREDIT",
        amount: (l.delta > 0n ? l.delta : -l.delta) as Paise,
      })),
      netGain > 0n
        ? { accountId: this.accounts.gain, side: "CREDIT" as const, amount: netGain }
        : { accountId: this.accounts.loss, side: "DEBIT" as const, amount: (-netGain) as Paise },
    ];

    const entry = this.journal.post({
      date,
      narration: `FX revaluation ${period} — ${lines.length} monetary balance${lines.length === 1 ? "" : "s"}`,
      lines: entryLines,
      sourceModule: "fx",
      referenceId: period,
      createdBy: actor,
    });

    this.revalued.add(period);
    this.bus.emit({
      orgId: this.orgId,
      type: "fx.revalued",
      at: new Date().toISOString(),
      actor,
      payload: { period, netGain: netGain.toString(), accounts: lines.length, entryId: entry.id },
    });
    return { period, lines, netGain, journalEntryId: entry.id };
  }

  wasRevalued(period: PeriodKey): boolean {
    return this.revalued.has(period);
  }
}
