/**
 * Continuous accounting agents — the always-on layer that watches the books
 * between closes and raises exceptions before month-end, not during it.
 *
 * The design constraint that matters: an agent PROPOSES, a human DISPOSES.
 * Every finding is a Proposal with an explicit status; approving one is what
 * posts an entry, and the approval is attributed and audited. There is no
 * code path where an agent writes to the ledger on its own — that is the
 * difference between automation a controller will switch on and automation
 * they will switch off after the first surprise.
 *
 * Agents are deterministic rules over the ledger, not model calls. The LLM
 * sits above this and narrates what the agents found; it never decides what
 * counts as an exception, so findings are reproducible and explainable.
 */

import { Paise, ZERO, add, sub, abs, cmp, sum, mulRatio, formatINR } from "../money.js";
import { JournalEngine, JournalEntry } from "../journal.js";
import { EventBus } from "../events.js";
import { ChartOfAccounts } from "../accounts.js";
import { PeriodKey, periodOf, periodEnd, prevPeriod, periodRange } from "./periods.js";

export type ProposalKind =
  | "MISSING_ACCRUAL"
  | "UNUSUAL_AMOUNT"
  | "DUPLICATE_ENTRY"
  | "UNCATEGORIZED_SPEND"
  | "MISSING_RECOGNITION"
  | "STALE_RECEIVABLE"
  | "BUDGET_VARIANCE";

export type ProposalStatus = "OPEN" | "APPROVED" | "DISMISSED";

export type Severity = "LOW" | "MEDIUM" | "HIGH";

export interface Proposal {
  readonly id: string;
  readonly kind: ProposalKind;
  readonly severity: Severity;
  readonly period: PeriodKey;
  readonly title: string;
  /** Plain-language reason a human can check without reading code. */
  readonly rationale: string;
  readonly amount: Paise | null;
  /** Journal entries the finding is based on — always drillable. */
  readonly evidence: readonly string[];
  /** Set only for proposals that would post something on approval. */
  readonly proposedEntry: ProposedEntry | null;
  readonly status: ProposalStatus;
  readonly raisedAt: string;
  readonly decidedBy: string | null;
  readonly decidedAt: string | null;
  readonly resultingEntryId: string | null;
}

export interface ProposedEntry {
  readonly date: string;
  readonly narration: string;
  readonly debitAccountId: string;
  readonly creditAccountId: string;
  readonly amount: Paise;
  readonly sourceModule: string;
}

export class AgentError extends Error {
  override name = "AgentError";
}

export interface AgentContextIn {
  readonly chart: ChartOfAccounts;
  readonly journal: JournalEngine;
  /** Vendors whose bills recur monthly — the accrual agent's watch list. */
  readonly recurringVendors: () => readonly { vendor: string; accountId: string; monthlyAmount: Paise }[];
  /** Bills actually recorded in a period, by vendor. */
  readonly billsInPeriod: (period: PeriodKey) => readonly { vendor: string; amount: Paise }[];
  /** Receivables older than the threshold. */
  readonly staleReceivables: (asOf: string, days: number) => readonly {
    readonly reference: string;
    readonly customer: string;
    readonly outstanding: Paise;
    readonly daysOverdue: number;
  }[];
  /** Contracts whose schedule shows revenue due in a period, unrecognised. */
  readonly unrecognizedRevenue: (period: PeriodKey) => Paise;
}

export class AgentEngine {
  private proposals = new Map<string, Proposal>();
  private counter = 0;

  constructor(
    public readonly orgId: string,
    private ctx: AgentContextIn,
    private bus: EventBus,
    private thresholds = {
      /** A charge this many times the account's own median is unusual. */
      outlierMultiple: 3n,
      /** Ignore anything below this — noise, not signal. */
      floor: 500000n as Paise, // ₹5,000
      staleReceivableDays: 45,
    },
  ) {}

  /**
   * Run every agent for a period. Findings are deduplicated by their natural
   * key, so a re-run refreshes rather than piling up duplicates.
   */
  scan(period: PeriodKey, actor: string): readonly Proposal[] {
    const found = [
      ...this.missingAccruals(period),
      ...this.unusualAmounts(period),
      ...this.duplicateEntries(period),
      ...this.staleReceivables(period),
      ...this.missingRecognition(period),
    ];
    const raised: Proposal[] = [];
    for (const p of found) {
      const existing = [...this.proposals.values()].find(
        (x) => x.kind === p.kind && x.period === p.period && x.title === p.title,
      );
      if (existing) continue; // already raised; a decision on it stands
      this.proposals.set(p.id, p);
      raised.push(p);
    }
    this.bus.emit({
      orgId: this.orgId,
      type: "agents.scanned",
      at: new Date().toISOString(),
      actor,
      payload: { period, raised: raised.length, open: this.open().length },
    });
    return raised;
  }

  /* -------------------------------------------------------------- */
  /* Individual agents                                               */
  /* -------------------------------------------------------------- */

  /**
   * A vendor that bills every month and did not this month is usually an
   * invoice in transit, not a saved cost. Propose the accrual.
   */
  private missingAccruals(period: PeriodKey): Proposal[] {
    const billed = new Set(this.ctx.billsInPeriod(period).map((b) => b.vendor));
    return this.ctx
      .recurringVendors()
      .filter((v) => !billed.has(v.vendor))
      .filter((v) => cmp(v.monthlyAmount, this.thresholds.floor) >= 0)
      .map((v) =>
        this.propose({
          kind: "MISSING_ACCRUAL",
          severity: "MEDIUM",
          period,
          title: `Accrue ${v.vendor} for ${period}`,
          rationale:
            `${v.vendor} has billed every month at about ${formatINR(v.monthlyAmount)} but no bill was recorded ` +
            `in ${period}. Accruing keeps the expense in the period it belongs to; the accrual auto-reverses next month ` +
            `when the real invoice arrives.`,
          amount: v.monthlyAmount,
          evidence: [],
          proposedEntry: {
            date: periodEnd(period),
            narration: `Accrual — ${v.vendor} (${period})`,
            debitAccountId: v.accountId,
            creditAccountId: "acc_accrued_liabilities",
            amount: v.monthlyAmount,
            sourceModule: "accrual",
          },
        }),
      );
  }

  /** A charge far above the account's own median for the trailing year. */
  private unusualAmounts(period: PeriodKey): Proposal[] {
    const out: Proposal[] = [];
    const window = periodRange(this.monthsBefore(period, 12), period);
    const entries = this.ctx.journal
      .all()
      .filter((e) => window.includes(periodOf(e.date)) && e.reverses === null);

    const byAccount = new Map<string, { amounts: Paise[]; entries: JournalEntry[] }>();
    for (const e of entries) {
      for (const l of e.lines) {
        if (this.ctx.chart.get(l.accountId).type !== "EXPENSE") continue;
        const bucket = byAccount.get(l.accountId) ?? { amounts: [], entries: [] };
        bucket.amounts.push(l.amount);
        bucket.entries.push(e);
        byAccount.set(l.accountId, bucket);
      }
    }

    for (const [accountId, bucket] of byAccount) {
      if (bucket.amounts.length < 4) continue; // too little history to judge
      const median = this.median(bucket.amounts);
      if (median === ZERO) continue;
      const limit = mulRatio(median, this.thresholds.outlierMultiple, 1n);
      for (let i = 0; i < bucket.entries.length; i++) {
        const e = bucket.entries[i]!;
        const amount = bucket.amounts[i]!;
        if (periodOf(e.date) !== period) continue;
        if (cmp(amount, limit) <= 0) continue;
        if (cmp(amount, this.thresholds.floor) < 0) continue;
        out.push(
          this.propose({
            kind: "UNUSUAL_AMOUNT",
            severity: "HIGH",
            period,
            title: `${this.ctx.chart.get(accountId).name}: ${formatINR(amount)} on ${e.date}`,
            rationale:
              `This charge is more than ${this.thresholds.outlierMultiple}x the median ${formatINR(median)} ` +
              `for this account over the trailing year. Confirm it is correctly coded and not a duplicate or ` +
              `a one-off that belongs somewhere else.`,
            amount,
            evidence: [e.id],
            proposedEntry: null,
          }),
        );
      }
    }
    return out;
  }

  /** Same narration, same amount, close together — a probable double-post. */
  private duplicateEntries(period: PeriodKey): Proposal[] {
    const entries = this.ctx.journal
      .all()
      .filter((e) => periodOf(e.date) === period && e.reverses === null);
    const seen = new Map<string, JournalEntry>();
    const out: Proposal[] = [];
    for (const e of entries) {
      const total = sum(e.lines.filter((l) => l.side === "DEBIT").map((l) => l.amount));
      if (cmp(total, this.thresholds.floor) < 0) continue;
      const key = `${e.narration.toLowerCase().trim()}|${total}`;
      const prior = seen.get(key);
      if (prior) {
        out.push(
          this.propose({
            kind: "DUPLICATE_ENTRY",
            severity: "HIGH",
            period,
            title: `Possible duplicate: "${e.narration}" ${formatINR(total)}`,
            rationale:
              `Two entries in ${period} share the same narration and the same amount ` +
              `(${prior.date} and ${e.date}). If one is a double-post, reverse it — the ledger is append-only, ` +
              `so corrections happen by reversal, never by deletion.`,
            amount: total,
            evidence: [prior.id, e.id],
            proposedEntry: null,
          }),
        );
      } else {
        seen.set(key, e);
      }
    }
    return out;
  }

  private staleReceivables(period: PeriodKey): Proposal[] {
    const asOf = periodEnd(period);
    return this.ctx
      .staleReceivables(asOf, this.thresholds.staleReceivableDays)
      .map((r) =>
        this.propose({
          kind: "STALE_RECEIVABLE",
          severity: r.daysOverdue > 90 ? "HIGH" : "MEDIUM",
          period,
          title: `${r.customer} — ${formatINR(r.outstanding)} overdue ${r.daysOverdue} days`,
          rationale:
            `Invoice ${r.reference} has been outstanding ${r.daysOverdue} days. Past 90 days this usually needs ` +
            `either a collection push or a provision decision — carrying it at full value overstates assets.`,
          amount: r.outstanding,
          evidence: [],
          proposedEntry: null,
        }),
      );
  }

  private missingRecognition(period: PeriodKey): Proposal[] {
    const amount = this.ctx.unrecognizedRevenue(period);
    if (amount === ZERO) return [];
    return [
      this.propose({
        kind: "MISSING_RECOGNITION",
        severity: "HIGH",
        period,
        title: `${formatINR(amount)} of contracted revenue not yet recognised for ${period}`,
        rationale:
          `Active contracts have performance obligations satisfied in ${period} whose revenue has not been posted. ` +
          `Run revenue recognition for the period before closing, or the P&L understates revenue.`,
        amount,
        evidence: [],
        proposedEntry: null,
      }),
    ];
  }

  /* -------------------------------------------------------------- */
  /* Human decisions                                                 */
  /* -------------------------------------------------------------- */

  /**
   * Approving a proposal that carries a proposed entry is the ONLY path by
   * which an agent's suggestion reaches the ledger, and it is attributed to
   * the approver, not to the agent.
   */
  approve(proposalId: string, actor: string): Proposal {
    const p = this.get(proposalId);
    if (p.status !== "OPEN") throw new AgentError(`Proposal ${proposalId} is already ${p.status}`);
    let resultingEntryId: string | null = null;
    if (p.proposedEntry) {
      const e = p.proposedEntry;
      const entry = this.ctx.journal.post({
        date: e.date,
        narration: e.narration,
        lines: [
          { accountId: e.debitAccountId, side: "DEBIT", amount: e.amount },
          { accountId: e.creditAccountId, side: "CREDIT", amount: e.amount },
        ],
        sourceModule: e.sourceModule,
        referenceId: p.id,
        createdBy: actor,
      });
      resultingEntryId = entry.id;
    }
    const next: Proposal = {
      ...p,
      status: "APPROVED",
      decidedBy: actor,
      decidedAt: new Date().toISOString(),
      resultingEntryId,
    };
    this.proposals.set(p.id, next);
    this.bus.emit({
      orgId: this.orgId,
      type: "agents.approved",
      at: next.decidedAt!,
      actor,
      payload: { proposalId: p.id, kind: p.kind, entryId: resultingEntryId },
    });
    return next;
  }

  dismiss(proposalId: string, actor: string, reason: string): Proposal {
    const p = this.get(proposalId);
    if (p.status !== "OPEN") throw new AgentError(`Proposal ${proposalId} is already ${p.status}`);
    if (!reason.trim()) throw new AgentError("Dismissing a proposal requires a reason");
    const next: Proposal = {
      ...p,
      status: "DISMISSED",
      decidedBy: actor,
      decidedAt: new Date().toISOString(),
      resultingEntryId: null,
    };
    this.proposals.set(p.id, next);
    this.bus.emit({
      orgId: this.orgId,
      type: "agents.dismissed",
      at: next.decidedAt!,
      actor,
      payload: { proposalId: p.id, kind: p.kind, reason },
    });
    return next;
  }

  get(proposalId: string): Proposal {
    const p = this.proposals.get(proposalId);
    if (!p) throw new AgentError(`Unknown proposal ${proposalId}`);
    return p;
  }

  open(): readonly Proposal[] {
    return this.byStatus("OPEN");
  }

  byStatus(status: ProposalStatus): readonly Proposal[] {
    const rank: Record<Severity, number> = { HIGH: 0, MEDIUM: 1, LOW: 2 };
    return [...this.proposals.values()]
      .filter((p) => p.status === status)
      .sort((a, b) => rank[a.severity] - rank[b.severity] || a.title.localeCompare(b.title));
  }

  all(): readonly Proposal[] {
    return [...this.proposals.values()];
  }

  private propose(
    input: Omit<Proposal, "id" | "status" | "raisedAt" | "decidedBy" | "decidedAt" | "resultingEntryId">,
  ): Proposal {
    return {
      ...input,
      id: `prop_${this.orgId}_${++this.counter}`,
      status: "OPEN",
      raisedAt: new Date().toISOString(),
      decidedBy: null,
      decidedAt: null,
      resultingEntryId: null,
    };
  }

  private median(amounts: readonly Paise[]): Paise {
    const sorted = [...amounts].sort((a, b) => cmp(a, b));
    const mid = Math.floor(sorted.length / 2);
    if (sorted.length % 2 === 1) return sorted[mid]!;
    return mulRatio(add(sorted[mid - 1]!, sorted[mid]!), 1n, 2n);
  }

  private monthsBefore(period: PeriodKey, n: number): PeriodKey {
    let cur = period;
    for (let i = 0; i < n; i++) cur = prevPeriod(cur);
    return cur;
  }
}
