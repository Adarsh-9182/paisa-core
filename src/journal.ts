/**
 * Journal Engine — the immutable heart of Paisa.
 *
 * Invariants enforced in code, not convention:
 *  1. Every entry balances: Σ debits === Σ credits, or it is rejected.
 *  2. Append-only: posted entries are frozen; there is no update or delete.
 *  3. Corrections happen via reversal entries linked to the original.
 *  4. Every entry is scoped to exactly one organization.
 */

import { Paise, sum } from "./money.js";
import { ChartOfAccounts, Side } from "./accounts.js";
import { EventBus } from "./events.js";

export interface JournalLine {
  readonly accountId: string;
  readonly side: Side;
  readonly amount: Paise; // strictly positive
}

export interface JournalEntry {
  readonly id: string;
  readonly orgId: string;
  readonly date: string; // ISO date (YYYY-MM-DD)
  readonly narration: string;
  readonly lines: readonly JournalLine[];
  readonly sourceModule: string; // "banking" | "invoice" | "manual" | ...
  readonly referenceId: string | null;
  readonly createdBy: string;
  readonly createdAt: string;
  readonly reverses: string | null; // id of the entry this reverses
  readonly reversedBy: string | null; // set (via projection) when a reversal exists
}

export class JournalError extends Error {
  override name = "JournalError";
}

/**
 * A posting guard vetoes an entry before it is written. Period close uses
 * this to make a closed period genuinely unpostable rather than merely
 * discouraged — the ledger cannot drift after a period is signed off.
 * A guard rejects by throwing; returning means "allowed".
 */
export interface PostingCandidate {
  readonly date: string;
  readonly sourceModule: string;
  readonly narration: string;
}

export type PostingGuard = (candidate: PostingCandidate) => void;

export interface PostInput {
  date: string;
  narration: string;
  lines: readonly JournalLine[];
  sourceModule: string;
  referenceId?: string | null;
  createdBy: string;
}

export class JournalEngine {
  private entries: JournalEntry[] = [];
  private byId = new Map<string, JournalEntry>();
  private reversalOf = new Map<string, string>(); // originalId -> reversalId
  private counter = 0;
  private guards: PostingGuard[] = [];

  constructor(
    public readonly orgId: string,
    private chart: ChartOfAccounts,
    private bus: EventBus,
  ) {
    if (chart.orgId !== orgId) throw new JournalError("Chart of accounts belongs to a different organization");
  }

  /** Register a veto (period close, entity lock). Guards run on post and reverse. */
  addGuard(guard: PostingGuard): void {
    this.guards.push(guard);
  }

  private assertAllowed(candidate: PostingCandidate): void {
    for (const g of this.guards) g(candidate);
  }

  post(input: PostInput): JournalEntry {
    this.assertDate(input.date);
    this.assertAllowed({ date: input.date, sourceModule: input.sourceModule, narration: input.narration });
    this.validate(input.lines);
    const entry: JournalEntry = Object.freeze({
      id: `je_${this.orgId}_${++this.counter}`,
      orgId: this.orgId,
      date: input.date,
      narration: input.narration,
      lines: Object.freeze(input.lines.map((l) => Object.freeze({ ...l }))),
      sourceModule: input.sourceModule,
      referenceId: input.referenceId ?? null,
      createdBy: input.createdBy,
      createdAt: new Date().toISOString(),
      reverses: null,
      reversedBy: null,
    });
    this.entries.push(entry);
    this.byId.set(entry.id, entry);
    this.bus.emit({
      orgId: this.orgId,
      type: "journal.posted",
      at: entry.createdAt,
      actor: input.createdBy,
      payload: { entryId: entry.id, narration: entry.narration },
    });
    return entry;
  }

  /** Corrections are new reversal entries; history is never rewritten. */
  reverse(originalId: string, actor: string, reason: string, date?: string): JournalEntry {
    const original = this.get(originalId);
    if (this.reversalOf.has(originalId))
      throw new JournalError(`Entry ${originalId} is already reversed by ${this.reversalOf.get(originalId)}`);
    if (original.reverses !== null)
      throw new JournalError(`Cannot reverse a reversal entry (${originalId}); post a fresh correct entry instead`);

    if (date !== undefined) this.assertDate(date, "reversal date");
    const narration = `REVERSAL of ${originalId}: ${reason}`;
    this.assertAllowed({ date: date ?? original.date, sourceModule: original.sourceModule, narration });

    const flipped = original.lines.map((l) => ({
      accountId: l.accountId,
      side: (l.side === "DEBIT" ? "CREDIT" : "DEBIT") as Side,
      amount: l.amount,
    }));
    this.validate(flipped);
    const entry: JournalEntry = Object.freeze({
      id: `je_${this.orgId}_${++this.counter}`,
      orgId: this.orgId,
      date: date ?? original.date,
      narration,
      lines: Object.freeze(flipped.map((l) => Object.freeze(l))),
      sourceModule: original.sourceModule,
      referenceId: original.referenceId,
      createdBy: actor,
      createdAt: new Date().toISOString(),
      reverses: originalId,
      reversedBy: null,
    });
    this.entries.push(entry);
    this.byId.set(entry.id, entry);
    this.reversalOf.set(originalId, entry.id);
    this.bus.emit({
      orgId: this.orgId,
      type: "journal.reversed",
      at: entry.createdAt,
      actor,
      payload: { originalId, reversalId: entry.id, reason },
    });
    return entry;
  }

  get(id: string): JournalEntry {
    const e = this.byId.get(id);
    if (!e) throw new JournalError(`Unknown journal entry ${id}`);
    const reversedBy = this.reversalOf.get(id) ?? null;
    return reversedBy ? { ...e, reversedBy } : e;
  }

  all(): readonly JournalEntry[] {
    return this.entries.map((e) => {
      const reversedBy = this.reversalOf.get(e.id) ?? null;
      return reversedBy ? { ...e, reversedBy } : e;
    });
  }

  upTo(dateISO: string): readonly JournalEntry[] {
    return this.all().filter((e) => e.date <= dateISO);
  }

  between(fromISO: string, toISO: string): readonly JournalEntry[] {
    return this.all().filter((e) => e.date >= fromISO && e.date <= toISO);
  }

  /**
   * A date the rest of the system can actually filter on.
   *
   * Every report, period and balance in Paisa is a string comparison against
   * YYYY-MM-DD. An entry dated anything else still balances, so nothing
   * complains — it simply never appears in a date range again. The money is
   * in the ledger and absent from every statement that should show it, which
   * is the worst of both: no error to notice, and books that do not add up to
   * what the reports say.
   *
   * Checked here rather than at the callers because there is exactly one way
   * into the ledger, and this is it.
   */
  private assertDate(date: string, field = "date"): void {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date))
      throw new JournalError(`Invalid ${field} "${date}": expected YYYY-MM-DD`);
    // Catches the ones that match the shape but are not days — "2026-02-30",
    // "2026-13-01" — which Date would otherwise roll forward into a
    // different month without complaint.
    const [y, m, d] = date.split("-").map(Number) as [number, number, number];
    const asDate = new Date(Date.UTC(y, m - 1, d));
    if (asDate.getUTCFullYear() !== y || asDate.getUTCMonth() !== m - 1 || asDate.getUTCDate() !== d)
      throw new JournalError(`Invalid ${field} "${date}": not a real calendar date`);
  }

  private validate(lines: readonly JournalLine[]): void {
    if (lines.length < 2) throw new JournalError("A journal entry needs at least two lines");
    for (const l of lines) {
      this.chart.get(l.accountId); // throws if unknown or cross-org
      if (l.amount <= 0n) throw new JournalError(`Line amount must be positive (account ${l.accountId})`);
    }
    const debits = sum(lines.filter((l) => l.side === "DEBIT").map((l) => l.amount));
    const credits = sum(lines.filter((l) => l.side === "CREDIT").map((l) => l.amount));
    if (debits !== credits)
      throw new JournalError(`Unbalanced entry: debits ${debits} ≠ credits ${credits}`);
  }
}
