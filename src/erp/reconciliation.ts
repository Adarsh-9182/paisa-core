/**
 * Bank reconciliation.
 *
 * Matching is deterministic and tiered, best evidence first:
 *   1. exact amount + exact date
 *   2. exact amount within a date window (settlement lag)
 *   3. exact amount + a shared reference token
 * Anything that survives all three stays unmatched and is shown to a human.
 * There is no fuzzy amount matching — a bank line that is ₹1 different from
 * a ledger entry is a discrepancy to investigate, not a match to assume.
 *
 * A reconciliation can only be COMPLETED when the difference is zero:
 *   statement closing balance
 *     − deposits in transit (booked, not yet on the statement)
 *     + outstanding payments (booked, not yet cleared)
 *   = book balance
 * That identity is the whole point, so it is checked, not asserted.
 */

import { Paise, ZERO, add, sub, sum } from "../money.js";
import { EventBus } from "../events.js";
import { daysBetween } from "../invoices.js";

export class ReconciliationError extends Error {
  override name = "ReconciliationError";
}

export interface ReconStatementLine {
  readonly reference: string;
  readonly date: string;
  readonly description: string;
  /** Signed: positive is money into the account. */
  readonly amount: Paise;
}

export interface BookEntry {
  readonly entryId: string;
  readonly date: string;
  readonly narration: string;
  /** Signed the same way as a statement line. */
  readonly amount: Paise;
}

export type MatchBasis = "EXACT_DATE" | "DATE_WINDOW" | "REFERENCE";

export interface Match {
  readonly statementRef: string;
  readonly entryId: string;
  readonly amount: Paise;
  readonly basis: MatchBasis;
  readonly dayGap: number;
}

export interface Reconciliation {
  readonly id: string;
  readonly accountId: string;
  readonly asOf: string;
  readonly statementClosingBalance: Paise;
  readonly bookBalance: Paise;
  readonly matches: readonly Match[];
  /** On the statement, not in the books — usually bank fees or interest. */
  readonly unmatchedStatement: readonly ReconStatementLine[];
  /** In the books, not on the statement — deposits in transit / uncleared. */
  readonly unmatchedBook: readonly BookEntry[];
  readonly depositsInTransit: Paise;
  readonly outstandingPayments: Paise;
  readonly difference: Paise;
  readonly reconciled: boolean;
  readonly status: "DRAFT" | "COMPLETED";
}

const tokens = (s: string): string[] =>
  s.toLowerCase().split(/[^a-z0-9]+/).filter((t) => t.length >= 4);

export class ReconciliationEngine {
  private reconciliations = new Map<string, Reconciliation>();
  private counter = 0;

  constructor(
    public readonly orgId: string,
    private bus: EventBus,
    /** How many days a booked entry may lag its bank line. */
    private windowDays = 5,
  ) {}

  /**
   * Build a reconciliation. Pure with respect to the ledger — it reads the
   * book entries it is handed and never posts anything on its own.
   */
  reconcile(input: {
    accountId: string;
    asOf: string;
    statementLines: readonly ReconStatementLine[];
    statementClosingBalance: Paise;
    bookEntries: readonly BookEntry[];
    bookBalance: Paise;
  }): Reconciliation {
    const unmatchedBook = [...input.bookEntries];
    const matches: Match[] = [];
    const unmatchedStatement: ReconStatementLine[] = [];

    const take = (predicate: (e: BookEntry) => boolean): BookEntry | null => {
      const i = unmatchedBook.findIndex(predicate);
      if (i === -1) return null;
      return unmatchedBook.splice(i, 1)[0]!;
    };

    for (const line of input.statementLines) {
      const exact = take((e) => e.amount === line.amount && e.date === line.date);
      if (exact) {
        matches.push({ statementRef: line.reference, entryId: exact.entryId, amount: line.amount, basis: "EXACT_DATE", dayGap: 0 });
        continue;
      }
      const windowed = take(
        (e) => e.amount === line.amount && Math.abs(daysBetween(e.date, line.date)) <= this.windowDays,
      );
      if (windowed) {
        matches.push({
          statementRef: line.reference,
          entryId: windowed.entryId,
          amount: line.amount,
          basis: "DATE_WINDOW",
          dayGap: Math.abs(daysBetween(windowed.date, line.date)),
        });
        continue;
      }
      const lineTokens = new Set([...tokens(line.description), ...tokens(line.reference)]);
      const byReference = take(
        (e) => e.amount === line.amount && tokens(e.narration).some((t) => lineTokens.has(t)),
      );
      if (byReference) {
        matches.push({
          statementRef: line.reference,
          entryId: byReference.entryId,
          amount: line.amount,
          basis: "REFERENCE",
          dayGap: Math.abs(daysBetween(byReference.date, line.date)),
        });
        continue;
      }
      unmatchedStatement.push(line);
    }

    const depositsInTransit = sum(unmatchedBook.filter((e) => e.amount > 0n).map((e) => e.amount));
    const outstandingPayments = sum(
      unmatchedBook.filter((e) => e.amount < 0n).map((e) => (-e.amount) as Paise),
    );

    // statement + in-transit − outstanding should equal the books.
    const expectedBook = sub(add(input.statementClosingBalance, depositsInTransit), outstandingPayments);
    const difference = sub(input.bookBalance, expectedBook);

    const rec: Reconciliation = {
      id: `rec_${this.orgId}_${++this.counter}`,
      accountId: input.accountId,
      asOf: input.asOf,
      statementClosingBalance: input.statementClosingBalance,
      bookBalance: input.bookBalance,
      matches,
      unmatchedStatement,
      unmatchedBook,
      depositsInTransit,
      outstandingPayments,
      difference,
      reconciled: difference === ZERO,
      status: "DRAFT",
    };
    this.reconciliations.set(rec.id, rec);
    return rec;
  }

  /** Sign off. Refuses while the difference is non-zero. */
  complete(reconciliationId: string, actor: string): Reconciliation {
    const rec = this.get(reconciliationId);
    if (!rec.reconciled)
      throw new ReconciliationError(
        `Cannot complete: the account is out by ${rec.difference} paise. Resolve the unexplained difference first.`,
      );
    const next: Reconciliation = { ...rec, status: "COMPLETED" };
    this.reconciliations.set(rec.id, next);
    this.bus.emit({
      orgId: this.orgId,
      type: "reconciliation.completed",
      at: new Date().toISOString(),
      actor,
      payload: { reconciliationId: rec.id, accountId: rec.accountId, asOf: rec.asOf },
    });
    return next;
  }

  get(reconciliationId: string): Reconciliation {
    const r = this.reconciliations.get(reconciliationId);
    if (!r) throw new ReconciliationError(`Unknown reconciliation ${reconciliationId}`);
    return r;
  }

  all(): readonly Reconciliation[] {
    return [...this.reconciliations.values()];
  }

  /** The latest completed reconciliation for an account, if any. */
  latestCompleted(accountId: string): Reconciliation | null {
    return (
      this.all()
        .filter((r) => r.accountId === accountId && r.status === "COMPLETED")
        .sort((a, b) => b.asOf.localeCompare(a.asOf))[0] ?? null
    );
  }
}
