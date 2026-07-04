/**
 * Recurring Payment Detection + Subscription Optimizer.
 *
 * Scans the journal (nothing else — the ledger is the only source of truth)
 * for expense debits that repeat on a roughly monthly cadence with a stable
 * amount. Purely deterministic: a payment is "recurring" iff it has at least
 * three occurrences, every gap is 20–40 days, and no amount deviates from
 * the group median by more than 20%.
 */

import { Paise, abs, sub, sum, mulRatio, paise } from "./money.js";
import { ChartOfAccounts } from "./accounts.js";
import { JournalEngine } from "./journal.js";
import { daysBetween } from "./invoices.js";

export interface RecurringPayment {
  readonly name: string; // normalized narration
  readonly accountId: string;
  readonly accountName: string;
  readonly monthlyAmount: Paise; // most recent occurrence
  readonly annualizedCost: Paise;
  readonly occurrences: number;
  readonly firstDate: string;
  readonly lastDate: string;
  readonly nextExpectedDate: string;
  readonly isSubscription: boolean; // software/utilities-type spend
}

const SUBSCRIPTION_ACCOUNTS = new Set(["acc_software", "acc_utilities"]);

export class RecurringDetector {
  constructor(
    private chart: ChartOfAccounts,
    private journal: JournalEngine,
  ) {}

  detect(asOf: string): readonly RecurringPayment[] {
    // Collect expense debits grouped by (accountId, normalized narration).
    const groups = new Map<string, { accountId: string; name: string; hits: { date: string; amount: Paise }[] }>();
    for (const e of this.journal.upTo(asOf)) {
      if (e.reverses !== null || e.reversedBy !== null) continue; // corrections aren't spend patterns
      for (const l of e.lines) {
        const acct = this.chart.get(l.accountId);
        if (acct.type !== "EXPENSE" || l.side !== "DEBIT") continue;
        const name = normalizeNarration(e.narration);
        const key = `${l.accountId}|${name}`;
        const g = groups.get(key) ?? { accountId: l.accountId, name, hits: [] };
        g.hits.push({ date: e.date, amount: l.amount });
        groups.set(key, g);
      }
    }

    const out: RecurringPayment[] = [];
    for (const g of groups.values()) {
      g.hits.sort((a, b) => (a.date < b.date ? -1 : 1));
      if (g.hits.length < 3) continue;
      const gapsMonthly = g.hits.every((h, i) => {
        if (i === 0) return true;
        const gap = daysBetween(g.hits[i - 1]!.date, h.date);
        return gap >= 20 && gap <= 40;
      });
      if (!gapsMonthly) continue;
      const median = medianPaise(g.hits.map((h) => h.amount));
      const stable = g.hits.every((h) => {
        const deviation = abs(sub(h.amount, median));
        return deviation * 5n <= (median < 0n ? -median : median); // ≤20%
      });
      if (!stable) continue;

      const last = g.hits[g.hits.length - 1]!;
      const first = g.hits[0]!;
      out.push({
        name: g.name,
        accountId: g.accountId,
        accountName: this.chart.get(g.accountId).name,
        monthlyAmount: last.amount,
        annualizedCost: mulRatio(last.amount, 12n, 1n),
        occurrences: g.hits.length,
        firstDate: first.date,
        lastDate: last.date,
        nextExpectedDate: addDays(last.date, 30),
        isSubscription: SUBSCRIPTION_ACCOUNTS.has(g.accountId),
      });
    }
    return out.sort((a, b) => (a.monthlyAmount > b.monthlyAmount ? -1 : 1));
  }

  /** Total committed monthly recurring spend and the subscription share of it. */
  summary(asOf: string): {
    monthlyCommitted: Paise;
    annualizedCommitted: Paise;
    subscriptionMonthly: Paise;
    items: readonly RecurringPayment[];
  } {
    const items = this.detect(asOf);
    const monthlyCommitted = sum(items.map((i) => i.monthlyAmount));
    return {
      monthlyCommitted,
      annualizedCommitted: mulRatio(monthlyCommitted, 12n, 1n),
      subscriptionMonthly: sum(items.filter((i) => i.isSubscription).map((i) => i.monthlyAmount)),
      items,
    };
  }
}

/** Strip dates, invoice numbers, and month names so "Rent June" and "Rent July" group together. */
const normalizeNarration = (s: string): string =>
  s
    .toLowerCase()
    .replace(/\b(january|february|march|april|may|june|july|august|september|october|november|december)\b/g, "")
    .replace(/\b(jan|feb|mar|apr|jun|jul|aug|sep|sept|oct|nov|dec)\b/g, "")
    .replace(/\d{4}-\d{2}(-\d{2})?/g, "")
    .replace(/#\s*\S+/g, "")
    .replace(/:/g, " ")
    .replace(/\d+/g, "")
    .replace(/\s+/g, " ")
    .trim();

const medianPaise = (xs: readonly Paise[]): Paise => {
  const sorted = [...xs].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[mid]!;
  return mulRatio(paise(sorted[mid - 1]! + sorted[mid]!), 1n, 2n);
};

const addDays = (iso: string, days: number): string => {
  const d = new Date(iso + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};
