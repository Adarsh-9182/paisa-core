/**
 * Accounting periods and the close lock.
 *
 * A period moves OPEN → SOFT_CLOSED → CLOSED and the lock is real: once a
 * period is CLOSED the journal itself refuses to accept an entry dated
 * inside it (via a PostingGuard), so a "closed" month cannot quietly drift.
 *
 * SOFT_CLOSED is the state the close checklist runs in: subledgers are
 * frozen but the close modules (accruals, revrec, FX revaluation, manual
 * adjustments) may still post. Reopening is allowed, logged, and never
 * silent — auditors need to see that it happened.
 *
 * Close is sequential: March cannot close while February is still open.
 */

import { EventBus } from "../events.js";
import { PostingCandidate, PostingGuard } from "../journal.js";

export type PeriodStatus = "OPEN" | "SOFT_CLOSED" | "CLOSED";

/** A period key is "YYYY-MM" — the calendar month the entry lands in. */
export type PeriodKey = string;

export class PeriodError extends Error {
  override name = "PeriodError";
}

/** Modules still allowed to post while a period is SOFT_CLOSED. */
export const CLOSE_MODULES: ReadonlySet<string> = new Set([
  "close",
  "accrual",
  "revrec",
  "amortization",
  "depreciation",
  "fx",
  "consolidation",
  "manual",
  /**
   * Clearing the bank review queue.
   *
   * Distinct from "banking", which is the feed auto-posting itself and stays
   * frozen — a statement imported after the freeze is new subledger activity
   * and belongs in the next period. This is the opposite case: the line
   * arrived before the freeze, the close checklist refuses to complete until
   * it is booked, and without this the checklist demands work the freeze has
   * made impossible. The close blocks on a line that cannot be cleared, and
   * the only way out is reopening the period — an audit event, for what is
   * routine categorisation.
   */
  "banking_review",
]);

export const periodOf = (dateISO: string): PeriodKey => dateISO.slice(0, 7);

export const periodStart = (p: PeriodKey): string => `${p}-01`;

export const periodEnd = (p: PeriodKey): string => {
  const [y, m] = p.split("-").map(Number) as [number, number];
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return `${p}-${String(last).padStart(2, "0")}`;
};

export const nextPeriod = (p: PeriodKey): PeriodKey => {
  const [y, m] = p.split("-").map(Number) as [number, number];
  return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, "0")}`;
};

export const prevPeriod = (p: PeriodKey): PeriodKey => {
  const [y, m] = p.split("-").map(Number) as [number, number];
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, "0")}`;
};

/** Inclusive list of period keys from `from` to `to`. */
export const periodRange = (from: PeriodKey, to: PeriodKey): PeriodKey[] => {
  if (to < from) return [];
  const out: PeriodKey[] = [];
  let cur = from;
  while (cur <= to) {
    out.push(cur);
    cur = nextPeriod(cur);
  }
  return out;
};

export interface PeriodRecord {
  readonly period: PeriodKey;
  readonly status: PeriodStatus;
  readonly closedBy: string | null;
  readonly closedAt: string | null;
  /** Every state change, including reopens, in order. */
  readonly history: readonly PeriodTransition[];
}

export interface PeriodTransition {
  readonly from: PeriodStatus;
  readonly to: PeriodStatus;
  readonly actor: string;
  readonly at: string;
  readonly reason: string | null;
}

export class PeriodEngine {
  private records = new Map<PeriodKey, PeriodRecord>();

  constructor(
    public readonly orgId: string,
    private bus: EventBus,
    /** First period the books exist for; anything earlier is unpostable. */
    public readonly firstPeriod: PeriodKey,
  ) {}

  /** The guard to hand to JournalEngine.addGuard(). */
  guard(): PostingGuard {
    return (candidate: PostingCandidate) => this.assertPostable(candidate);
  }

  assertPostable(candidate: PostingCandidate): void {
    const p = periodOf(candidate.date);
    if (p < this.firstPeriod)
      throw new PeriodError(
        `Cannot post to ${p}: the books begin ${this.firstPeriod}`,
      );
    const status = this.status(p);
    if (status === "CLOSED")
      throw new PeriodError(
        `Period ${p} is closed. Reopen it, or post the correction to an open period.`,
      );
    if (status === "SOFT_CLOSED" && !CLOSE_MODULES.has(candidate.sourceModule))
      throw new PeriodError(
        `Period ${p} is soft-closed: "${candidate.sourceModule}" entries are frozen. ` +
          `Only close adjustments (${[...CLOSE_MODULES].join(", ")}) may post.`,
      );
  }

  status(period: PeriodKey): PeriodStatus {
    return this.records.get(period)?.status ?? "OPEN";
  }

  record(period: PeriodKey): PeriodRecord {
    return (
      this.records.get(period) ?? {
        period,
        status: "OPEN",
        closedBy: null,
        closedAt: null,
        history: [],
      }
    );
  }

  all(): readonly PeriodRecord[] {
    return [...this.records.values()].sort((a, b) => a.period.localeCompare(b.period));
  }

  /** Freeze the subledgers so the close checklist can run. */
  softClose(period: PeriodKey, actor: string): PeriodRecord {
    return this.transition(period, "SOFT_CLOSED", actor, null);
  }

  /** Sign the period off. Requires every earlier period to be closed. */
  close(period: PeriodKey, actor: string): PeriodRecord {
    for (const earlier of periodRange(this.firstPeriod, prevPeriod(period))) {
      if (this.status(earlier) !== "CLOSED")
        throw new PeriodError(
          `Cannot close ${period} while ${earlier} is ${this.status(earlier)} — close periods in order.`,
        );
    }
    return this.transition(period, "CLOSED", actor, null);
  }

  /** Always logged: a reopened period is an audit event, never a quiet edit. */
  reopen(period: PeriodKey, actor: string, reason: string): PeriodRecord {
    if (!reason.trim()) throw new PeriodError("Reopening a period requires a stated reason");
    const current = this.status(period);
    if (current === "OPEN") throw new PeriodError(`Period ${period} is already open`);
    return this.transition(period, "OPEN", actor, reason);
  }

  private transition(
    period: PeriodKey,
    to: PeriodStatus,
    actor: string,
    reason: string | null,
  ): PeriodRecord {
    if (period < this.firstPeriod)
      throw new PeriodError(`Period ${period} precedes the first period ${this.firstPeriod}`);
    const prev = this.record(period);
    if (prev.status === to) throw new PeriodError(`Period ${period} is already ${to}`);
    const at = new Date().toISOString();
    const transition: PeriodTransition = { from: prev.status, to, actor, at, reason };
    const next: PeriodRecord = {
      period,
      status: to,
      closedBy: to === "CLOSED" ? actor : null,
      closedAt: to === "CLOSED" ? at : null,
      history: [...prev.history, transition],
    };
    this.records.set(period, next);
    this.bus.emit({
      orgId: this.orgId,
      type: `period.${to.toLowerCase()}`,
      at,
      actor,
      payload: { period, from: prev.status, to, ...(reason ? { reason } : {}) },
    });
    return next;
  }
}
