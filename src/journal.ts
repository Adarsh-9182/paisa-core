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

  constructor(
    public readonly orgId: string,
    private chart: ChartOfAccounts,
    private bus: EventBus,
  ) {
    if (chart.orgId !== orgId) throw new JournalError("Chart of accounts belongs to a different organization");
  }

  post(input: PostInput): JournalEntry {
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
      narration: `REVERSAL of ${originalId}: ${reason}`,
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
