/**
 * General Ledger + Trial Balance — pure projections over the journal.
 * The ledger is never stored separately, so it can never disagree with
 * the journal. Drill-down: balance → ledger rows → journal entry.
 */

import { Paise, ZERO, add, sub, neg } from "./money.js";
import { Account, ChartOfAccounts, NORMAL_BALANCE } from "./accounts.js";
import { JournalEngine, JournalEntry } from "./journal.js";

export interface LedgerRow {
  readonly entryId: string;
  readonly date: string;
  readonly narration: string;
  readonly debit: Paise;
  readonly credit: Paise;
  readonly runningBalance: Paise; // signed in the account's normal-balance direction
}

export interface TrialBalanceRow {
  readonly account: Account;
  readonly debit: Paise;
  readonly credit: Paise;
}

export interface TrialBalance {
  readonly asOf: string;
  readonly rows: readonly TrialBalanceRow[];
  readonly totalDebit: Paise;
  readonly totalCredit: Paise;
  readonly balanced: boolean;
}

export class Ledger {
  constructor(private chart: ChartOfAccounts, private journal: JournalEngine) {}

  /** Signed balance of an account in its normal-balance direction, as of a date. */
  balance(accountId: string, asOf: string): Paise {
    const account = this.chart.get(accountId);
    const normal = NORMAL_BALANCE[account.type];
    let bal: Paise = ZERO;
    for (const e of this.journal.upTo(asOf)) {
      for (const l of e.lines) {
        if (l.accountId !== accountId) continue;
        bal = l.side === normal ? add(bal, l.amount) : sub(bal, l.amount);
      }
    }
    return bal;
  }

  rows(accountId: string, asOf: string): readonly LedgerRow[] {
    const account = this.chart.get(accountId);
    const normal = NORMAL_BALANCE[account.type];
    const out: LedgerRow[] = [];
    let bal: Paise = ZERO;
    for (const e of this.journal.upTo(asOf)) {
      for (const l of e.lines) {
        if (l.accountId !== accountId) continue;
        bal = l.side === normal ? add(bal, l.amount) : sub(bal, l.amount);
        out.push({
          entryId: e.id,
          date: e.date,
          narration: e.narration,
          debit: l.side === "DEBIT" ? l.amount : ZERO,
          credit: l.side === "CREDIT" ? l.amount : ZERO,
          runningBalance: bal,
        });
      }
    }
    return out;
  }

  trialBalance(asOf: string): TrialBalance {
    const rows: TrialBalanceRow[] = [];
    let totalDebit: Paise = ZERO;
    let totalCredit: Paise = ZERO;
    for (const account of this.chart.all()) {
      const bal = this.balance(account.id, asOf);
      if (bal === 0n) continue;
      const normal = NORMAL_BALANCE[account.type];
      const positive = bal >= 0n;
      const side = positive === (normal === "DEBIT") ? "DEBIT" : "CREDIT";
      const amount = bal < 0n ? neg(bal) : bal;
      const debit = side === "DEBIT" ? amount : ZERO;
      const credit = side === "CREDIT" ? amount : ZERO;
      totalDebit = add(totalDebit, debit);
      totalCredit = add(totalCredit, credit);
      rows.push({ account, debit, credit });
    }
    return {
      asOf,
      rows,
      totalDebit,
      totalCredit,
      balanced: totalDebit === totalCredit,
    };
  }
}
