/**
 * Transaction screening (spec 006) — deterministic fraud/anomaly detection
 * over the org's own ledger.
 *
 * This is the architecture-correct home for "fraud detection" in Paisa:
 * auditable rules over real journal entries, exposed to the AI as a tool.
 * No trained classifier, no probabilities the user can't inspect — every
 * finding names the exact entries and the rule that fired. When a real
 * labelled dataset and a classical model arrive later, they slot in behind
 * this same interface as another deterministic-at-inference tool.
 *
 * v1 signals:
 *   1. duplicate_payment — same normalized narration + same amount posted
 *      more than once within 7 days (double-billed vendor, double-entered
 *      bill). High severity.
 *   2. amount_outlier — an expense debit at least 5× the account's median
 *      charge in the window (and above a ₹10,000 floor, so tiny accounts
 *      don't cry wolf). Medium severity.
 */

import { JournalEntry } from "./journal.js";
import { Paise, parseINR } from "./money.js";
import { Organization } from "./organization.js";

export type AnomalyKind = "duplicate_payment" | "amount_outlier";

export interface AnomalyFinding {
  readonly kind: AnomalyKind;
  readonly severity: "high" | "medium";
  readonly date: string; // date of the latest offending entry
  readonly accountName: string;
  readonly amount: Paise;
  readonly narration: string;
  readonly entryIds: readonly string[];
  readonly detail: string;
}

export interface ScreeningReport {
  readonly from: string;
  readonly to: string;
  readonly entriesChecked: number;
  readonly findings: readonly AnomalyFinding[];
}

const DUPLICATE_WINDOW_DAYS = 7;
const OUTLIER_MULTIPLIER = 5n;
const OUTLIER_FLOOR: Paise = parseINR("10,000");
/** Below this many charges on an account, a "median" is noise, not a norm. */
const MIN_SAMPLES_FOR_OUTLIER = 5;

const shiftDays = (iso: string, days: number): string => {
  const [y, m, d] = iso.split("-").map(Number) as [number, number, number];
  const t = new Date(Date.UTC(y, m - 1, d + days));
  return t.toISOString().slice(0, 10);
};

const daysApart = (a: string, b: string): number =>
  Math.abs(Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) / 86_400_000;

const normalizeNarration = (s: string): string => s.toLowerCase().replace(/\s+/g, " ").trim();

const median = (sorted: readonly Paise[]): Paise => {
  const mid = sorted.length >> 1;
  return sorted.length % 2 ? sorted[mid]! : (((sorted[mid - 1]! + sorted[mid]!) / 2n) as Paise);
};

interface ExpenseDebit {
  readonly entry: JournalEntry;
  readonly accountId: string;
  readonly accountName: string;
  readonly amount: Paise;
}

/**
 * Screen the trailing window (default 90 days) for anomalies. Reversed
 * entries and the reversals themselves are corrections already made — they
 * are skipped, never re-flagged.
 */
export const screenTransactions = (org: Organization, asOf: string, windowDays = 90): ScreeningReport => {
  const from = shiftDays(asOf, -windowDays);
  const entries = org.journal
    .between(from, asOf)
    .filter((e) => e.reversedBy === null && e.reverses === null);

  const debits: ExpenseDebit[] = [];
  for (const entry of entries) {
    for (const line of entry.lines) {
      if (line.side !== "DEBIT") continue;
      const acct = org.chart.get(line.accountId);
      if (acct.type !== "EXPENSE") continue;
      debits.push({ entry, accountId: acct.id, accountName: acct.name, amount: line.amount });
    }
  }

  const findings: AnomalyFinding[] = [];

  // 1. Duplicate payments: same narration + amount, close together in time.
  const groups = new Map<string, ExpenseDebit[]>();
  for (const d of debits) {
    const key = `${normalizeNarration(d.entry.narration)}|${d.amount}`;
    groups.set(key, [...(groups.get(key) ?? []), d]);
  }
  for (const group of groups.values()) {
    const distinct = [...new Map(group.map((g) => [g.entry.id, g])).values()].sort((a, b) =>
      a.entry.date < b.entry.date ? -1 : 1,
    );
    if (distinct.length < 2) continue;
    const first = distinct[0]!;
    const last = distinct[distinct.length - 1]!;
    if (daysApart(first.entry.date, last.entry.date) > DUPLICATE_WINDOW_DAYS) continue;
    findings.push({
      kind: "duplicate_payment",
      severity: "high",
      date: last.entry.date,
      accountName: first.accountName,
      amount: first.amount,
      narration: first.entry.narration,
      entryIds: distinct.map((g) => g.entry.id),
      detail: `${distinct.length} identical postings within ${DUPLICATE_WINDOW_DAYS} days — verify this is not a double payment; if it is, reverse one entry.`,
    });
  }

  // 2. Amount outliers vs the account's own median charge.
  const byAccount = new Map<string, ExpenseDebit[]>();
  for (const d of debits) byAccount.set(d.accountId, [...(byAccount.get(d.accountId) ?? []), d]);
  for (const charges of byAccount.values()) {
    if (charges.length < MIN_SAMPLES_FOR_OUTLIER) continue;
    const med = median([...charges.map((c) => c.amount)].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)));
    if (med <= 0n) continue;
    for (const c of charges) {
      if (c.amount < OUTLIER_FLOOR || c.amount < med * OUTLIER_MULTIPLIER) continue;
      const times = c.amount / med;
      findings.push({
        kind: "amount_outlier",
        severity: "medium",
        date: c.entry.date,
        accountName: c.accountName,
        amount: c.amount,
        narration: c.entry.narration,
        entryIds: [c.entry.id],
        detail: `About ${times}x this account's typical charge in the window — confirm it is expected.`,
      });
    }
  }

  findings.sort((a, b) =>
    a.severity !== b.severity ? (a.severity === "high" ? -1 : 1) : a.date < b.date ? 1 : -1,
  );

  return { from, to: asOf, entriesChecked: entries.length, findings };
};
