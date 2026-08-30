/**
 * Revenue recognition — ASC 606 step 5, as a subledger over the journal.
 *
 * The schedule is derived, never stored as a balance: given a contract, the
 * per-period recognition amounts are a pure function of the allocated price
 * and the service period, and they always sum back to the allocated amount
 * exactly (remainder lands on the final period).
 *
 * The contract asset / contract liability pair is handled properly:
 *   recognised ahead of billing → DR Unbilled Receivable  (contract asset)
 *   billed ahead of recognition → CR Deferred Revenue     (contract liability)
 * A billing first clears any unbilled receivable, and only the excess
 * becomes deferred revenue. That is what makes the deferred-revenue
 * roll-forward tie to the ledger without a plug.
 *
 * Recognition is idempotent per (obligation, period): running the month twice
 * posts once. Re-running after a contract amendment picks up the new schedule
 * prospectively.
 */

import { Paise, ZERO, add, sub, sum, cmp, mulRatio } from "../money.js";
import { JournalEngine } from "../journal.js";
import { EventBus } from "../events.js";
import { daysBetween } from "../invoices.js";
import {
  Contract,
  ContractEngine,
  PerformanceObligation,
  termDays,
} from "./contracts.js";
import { PeriodKey, periodOf, periodStart, periodEnd, periodRange, nextPeriod } from "./periods.js";

export class RevRecError extends Error {
  override name = "RevRecError";
}

export interface ScheduleLine {
  readonly contractId: string;
  readonly obligationId: string;
  readonly description: string;
  readonly period: PeriodKey;
  readonly amount: Paise;
  readonly revenueAccountId: string;
  readonly method: string;
}

export interface RecognitionRun {
  readonly period: PeriodKey;
  readonly journalEntryId: string;
  readonly amount: Paise;
  /** The slice drawn out of deferred revenue (the rest created a contract asset). */
  readonly fromDeferred: Paise;
  readonly lineCount: number;
  readonly at: string;
  readonly actor: string;
}

export interface BillingRecord {
  readonly contractId: string;
  readonly billingEventId: string;
  readonly date: string;
  readonly net: Paise;
  /** The slice that became deferred revenue (the rest cleared a contract asset). */
  readonly toDeferred: Paise;
  readonly gst: Paise;
  readonly total: Paise;
  readonly journalEntryId: string;
}

export interface ContractPayment {
  readonly contractId: string;
  readonly billingEventId: string;
  readonly date: string;
  readonly amount: Paise;
  readonly journalEntryId: string;
}

export interface UsageReport {
  readonly contractId: string;
  readonly obligationId: string;
  readonly period: PeriodKey;
  readonly amount: Paise;
}

export interface WaterfallCell {
  readonly period: PeriodKey;
  readonly amount: Paise;
}

export interface DeferredRollforward {
  readonly period: PeriodKey;
  readonly opening: Paise;
  readonly billed: Paise;
  readonly recognized: Paise;
  readonly closing: Paise;
  /** Deferred-revenue balance straight off the GL for the same date. */
  readonly ledgerClosing: Paise;
  readonly tiesToLedger: boolean;
}

const daysInclusive = (from: string, to: string): number => daysBetween(from, to) + 1;

const overlapDays = (aFrom: string, aTo: string, bFrom: string, bTo: string): number => {
  const from = aFrom > bFrom ? aFrom : bFrom;
  const to = aTo < bTo ? aTo : bTo;
  return to < from ? 0 : daysInclusive(from, to);
};

/**
 * Per-period amounts for one obligation. Pure, and guaranteed to sum to
 * `po.allocated` — the remainder is pushed onto the last period.
 */
export const obligationSchedule = (
  contract: Contract,
  po: PerformanceObligation,
  usage: readonly UsageReport[] = [],
): readonly ScheduleLine[] => {
  const line = (period: PeriodKey, amount: Paise): ScheduleLine => ({
    contractId: contract.id,
    obligationId: po.id,
    description: po.description,
    period,
    amount,
    revenueAccountId: po.revenueAccountId,
    method: po.method,
  });

  if (po.method === "POINT_IN_TIME" || po.method === "MILESTONE") {
    // A milestone obligation recognises only once it has been delivered;
    // delivery is recorded as a usage-shaped report against the obligation.
    if (po.method === "MILESTONE") {
      const delivered = usage.filter((u) => u.obligationId === po.id);
      return delivered.map((u) => line(u.period, u.amount));
    }
    return [line(periodOf(po.startDate), po.allocated)];
  }

  if (po.method === "USAGE") {
    return usage.filter((u) => u.obligationId === po.id).map((u) => line(u.period, u.amount));
  }

  const end = po.endDate!;
  const periods = periodRange(periodOf(po.startDate), periodOf(end));
  if (periods.length === 0) return [];

  let amounts: Paise[];
  if (po.method === "RATABLE_MONTHLY") {
    const per = mulRatio(po.allocated, 1n, BigInt(periods.length));
    amounts = periods.map(() => per);
  } else {
    const total = BigInt(termDays(po.startDate, end));
    amounts = periods.map((p) =>
      mulRatio(
        po.allocated,
        BigInt(overlapDays(po.startDate, end, periodStart(p), periodEnd(p))),
        total,
      ),
    );
  }
  const drift = sub(po.allocated, sum(amounts));
  amounts[amounts.length - 1] = add(amounts[amounts.length - 1]!, drift);
  return periods.map((p, i) => line(p, amounts[i]!)).filter((l) => l.amount !== ZERO);
};

export class RevRecEngine {
  private runs = new Map<PeriodKey, RecognitionRun>();
  /** (obligationId|period) already recognised — the idempotency key. */
  private recognized = new Map<string, Paise>();
  private billings: BillingRecord[] = [];
  private payments: ContractPayment[] = [];
  private usage: UsageReport[] = [];

  constructor(
    public readonly orgId: string,
    private contracts: ContractEngine,
    private journal: JournalEngine,
    private bus: EventBus,
    private accounts = {
      deferredRevenue: "acc_deferred_revenue",
      unbilledAr: "acc_unbilled_ar",
      ar: "acc_ar",
      gstPayable: "acc_gst_payable",
    },
  ) {}

  /** Metered revenue for a period. Recognised when the next run covers it. */
  reportUsage(contractId: string, obligationId: string, period: PeriodKey, amount: Paise, actor: string): UsageReport {
    if (amount <= 0n) throw new RevRecError("Usage amount must be positive");
    const contract = this.contracts.get(contractId);
    const po = contract.obligations.find((o) => o.id === obligationId);
    if (!po) throw new RevRecError(`Unknown obligation ${obligationId} on ${contractId}`);
    if (po.method !== "USAGE" && po.method !== "MILESTONE")
      throw new RevRecError(`"${po.description}" is ${po.method}; usage may only be reported on USAGE or MILESTONE obligations`);
    const report: UsageReport = { contractId, obligationId, period, amount };
    this.usage.push(report);
    this.bus.emit({
      orgId: this.orgId,
      type: "revrec.usage_reported",
      at: new Date().toISOString(),
      actor,
      payload: { contractId, obligationId, period, amount: amount.toString() },
    });
    return report;
  }

  /** The full recognition schedule for one contract, all periods. */
  schedule(contractId: string): readonly ScheduleLine[] {
    const c = this.contracts.get(contractId);
    if (c.status === "CANCELLED") return [];
    return c.obligations.flatMap((po) => obligationSchedule(c, po, this.usage));
  }

  /** Every active contract's schedule, flattened. */
  allSchedules(): readonly ScheduleLine[] {
    return this.contracts
      .all()
      .filter((c) => c.status === "ACTIVE")
      .flatMap((c) => this.schedule(c.id));
  }

  /**
   * Recognise a period. Posts one journal entry covering every obligation
   * with revenue due in that period, and skips anything already recognised.
   */
  recognize(period: PeriodKey, actor: string): RecognitionRun | null {
    const due = this.allSchedules().filter(
      (l) => l.period === period && !this.recognized.has(this.key(l.obligationId, l.period)),
    );
    if (due.length === 0) return null;

    // Revenue credits, grouped by revenue account.
    const byRevenue = new Map<string, Paise>();
    for (const l of due) byRevenue.set(l.revenueAccountId, add(byRevenue.get(l.revenueAccountId) ?? ZERO, l.amount));
    const total = sum(due.map((l) => l.amount));

    // Split the debit between deferred revenue already collected and the
    // contract asset created when we recognise ahead of billing.
    let fromDeferred: Paise = ZERO;
    let toUnbilled: Paise = ZERO;
    const byContract = new Map<string, Paise>();
    for (const l of due) byContract.set(l.contractId, add(byContract.get(l.contractId) ?? ZERO, l.amount));
    for (const [contractId, amount] of byContract) {
      const available = this.deferredBalanceOf(contractId);
      const covered = cmp(available, amount) >= 0 ? amount : available > ZERO ? available : ZERO;
      fromDeferred = add(fromDeferred, covered);
      toUnbilled = add(toUnbilled, sub(amount, covered));
    }

    const lines = [
      ...(fromDeferred > 0n
        ? [{ accountId: this.accounts.deferredRevenue, side: "DEBIT" as const, amount: fromDeferred }]
        : []),
      ...(toUnbilled > 0n
        ? [{ accountId: this.accounts.unbilledAr, side: "DEBIT" as const, amount: toUnbilled }]
        : []),
      ...[...byRevenue.entries()].map(([accountId, amount]) => ({
        accountId,
        side: "CREDIT" as const,
        amount,
      })),
    ];

    const entry = this.journal.post({
      date: periodEnd(period),
      narration: `Revenue recognition ${period} — ${due.length} performance obligation${due.length === 1 ? "" : "s"}`,
      lines,
      sourceModule: "revrec",
      referenceId: period,
      createdBy: actor,
    });

    for (const l of due) this.recognized.set(this.key(l.obligationId, l.period), l.amount);
    const run: RecognitionRun = {
      period,
      journalEntryId: entry.id,
      amount: total,
      fromDeferred,
      lineCount: due.length,
      at: new Date().toISOString(),
      actor,
    };
    this.runs.set(period, run);
    this.bus.emit({
      orgId: this.orgId,
      type: "revrec.recognized",
      at: run.at,
      actor,
      payload: { period, amount: total.toString(), obligations: due.length, entryId: entry.id },
    });
    return run;
  }

  /**
   * Bill an instalment from the contract's billing schedule.
   * DR Accounts Receivable / CR Unbilled Receivable (to the extent revenue
   * was already recognised) / CR Deferred Revenue (the rest) / CR GST.
   */
  bill(contractId: string, billingEventId: string, actor: string, gstRatePct = 0): BillingRecord {
    const contract = this.contracts.get(contractId);
    if (contract.status !== "ACTIVE") throw new RevRecError(`Contract ${contractId} is ${contract.status}`);
    const event = contract.billingSchedule.find((b) => b.id === billingEventId);
    if (!event) throw new RevRecError(`Unknown billing event ${billingEventId}`);
    if (event.invoiceId !== null) throw new RevRecError(`Billing event ${billingEventId} is already invoiced`);

    const net = event.amount;
    const gst = mulRatio(net, BigInt(gstRatePct), 100n);
    const total = add(net, gst);

    const unbilled = this.unbilledBalanceOf(contractId);
    const clearsUnbilled = cmp(unbilled, net) >= 0 ? net : unbilled > ZERO ? unbilled : ZERO;
    const toDeferred = sub(net, clearsUnbilled);

    const entry = this.journal.post({
      date: event.dueDate,
      narration: `Contract ${contract.number} billing ${event.periodFrom}..${event.periodTo} — ${contract.customer}`,
      lines: [
        { accountId: this.accounts.ar, side: "DEBIT", amount: total },
        ...(clearsUnbilled > 0n
          ? [{ accountId: this.accounts.unbilledAr, side: "CREDIT" as const, amount: clearsUnbilled }]
          : []),
        ...(toDeferred > 0n
          ? [{ accountId: this.accounts.deferredRevenue, side: "CREDIT" as const, amount: toDeferred }]
          : []),
        ...(gst > 0n ? [{ accountId: this.accounts.gstPayable, side: "CREDIT" as const, amount: gst }] : []),
      ],
      sourceModule: "revrec",
      referenceId: contract.id,
      createdBy: actor,
    });

    this.contracts.markBilled(contractId, billingEventId, entry.id);
    const record: BillingRecord = {
      contractId,
      billingEventId,
      date: event.dueDate,
      net,
      toDeferred,
      gst,
      total,
      journalEntryId: entry.id,
    };
    this.billings.push(record);
    this.bus.emit({
      orgId: this.orgId,
      type: "revrec.billed",
      at: new Date().toISOString(),
      actor,
      payload: { contractId, billingEventId, total: total.toString(), entryId: entry.id },
    });
    return record;
  }

  /** Bill everything due on or before a date. Returns what was billed. */
  billDue(asOf: string, actor: string, gstRatePct = 0): readonly BillingRecord[] {
    return this.contracts
      .dueForBilling(asOf)
      .map(({ contract, event }) => this.bill(contract.id, event.id, actor, gstRatePct));
  }

  /**
   * Remaining performance obligation (RPO / backlog): revenue contracted
   * but not yet recognised, by future period. This is the deferred-revenue
   * waterfall finance teams present to boards and auditors.
   */
  waterfall(fromPeriod: PeriodKey, months: number): readonly WaterfallCell[] {
    const out: WaterfallCell[] = [];
    let p = fromPeriod;
    for (let i = 0; i < months; i++) {
      const amount = sum(
        this.allSchedules()
          .filter((l) => l.period === p && !this.recognized.has(this.key(l.obligationId, l.period)))
          .map((l) => l.amount),
      );
      out.push({ period: p, amount });
      p = nextPeriod(p);
    }
    return out;
  }

  /** Total contracted revenue not yet recognised, all future periods. */
  remainingPerformanceObligation(): Paise {
    return sum(
      this.allSchedules()
        .filter((l) => !this.recognized.has(this.key(l.obligationId, l.period)))
        .map((l) => l.amount),
    );
  }

  /**
   * Deferred-revenue roll-forward for a period, checked against the GL.
   * opening + billed − recognised = closing, and closing must equal the
   * ledger's deferred-revenue balance. A false `tiesToLedger` is a close
   * blocker, not a warning.
   */
  rollforward(period: PeriodKey, ledgerBalanceAt: (dateISO: string) => Paise): DeferredRollforward {
    const start = periodStart(period);
    const end = periodEnd(period);
    const opening = ledgerBalanceAt(dateBefore(start));
    // Only the deferred-revenue legs belong in this roll-forward: a billing
    // that cleared a contract asset never touched deferred revenue, and
    // revenue recognised ahead of billing came out of the contract asset.
    const billed = sum(
      this.billings
        .filter((b) => b.date >= start && b.date <= end)
        .map((b) => b.toDeferred),
    );
    const recognized = this.runs.get(period)?.fromDeferred ?? ZERO;
    const closing = sub(add(opening, billed), recognized);
    const ledgerClosing = ledgerBalanceAt(end);
    return {
      period,
      opening,
      billed,
      recognized,
      closing,
      ledgerClosing,
      tiesToLedger: closing === ledgerClosing,
    };
  }

  /**
   * Cash against a contract billing: DR Bank / CR Accounts Receivable.
   * Tracked here so the contract AR ties back to the GL control account at
   * close — a billing the subledger still shows as open must be open in the
   * ledger too.
   */
  recordPayment(
    contractId: string,
    billingEventId: string,
    date: string,
    amount: Paise,
    actor: string,
    bankAccountId = "acc_bank",
  ): ContractPayment {
    const billing = this.billings.find((b) => b.billingEventId === billingEventId);
    if (!billing) throw new RevRecError(`Billing event ${billingEventId} has not been invoiced`);
    if (amount <= 0n) throw new RevRecError("Payment amount must be positive");
    const outstanding = this.outstandingOf(billingEventId);
    if (cmp(amount, outstanding) > 0)
      throw new RevRecError(`Payment exceeds outstanding balance on ${billingEventId}`);

    const contract = this.contracts.get(contractId);
    const entry = this.journal.post({
      date,
      narration: `Payment received — contract ${contract.number} (${contract.customer})`,
      lines: [
        { accountId: bankAccountId, side: "DEBIT", amount },
        { accountId: this.accounts.ar, side: "CREDIT", amount },
      ],
      sourceModule: "revrec",
      referenceId: contractId,
      createdBy: actor,
    });

    const payment: ContractPayment = { contractId, billingEventId, date, amount, journalEntryId: entry.id };
    this.payments.push(payment);
    this.bus.emit({
      orgId: this.orgId,
      type: "revrec.payment",
      at: new Date().toISOString(),
      actor,
      payload: { contractId, billingEventId, amount: amount.toString(), entryId: entry.id },
    });
    return payment;
  }

  /** Amount still owed on one billing. */
  outstandingOf(billingEventId: string): Paise {
    const billing = this.billings.find((b) => b.billingEventId === billingEventId);
    if (!billing) return ZERO;
    const paid = sum(this.payments.filter((p) => p.billingEventId === billingEventId).map((p) => p.amount));
    return sub(billing.total, paid);
  }

  /** Total contract receivables still open — the AR subledger for contracts. */
  arOutstanding(asOf?: string): Paise {
    return sum(
      this.billings
        .filter((b) => (asOf ? b.date <= asOf : true))
        .map((b) => {
          const paid = sum(
            this.payments
              .filter((p) => p.billingEventId === b.billingEventId && (asOf ? p.date <= asOf : true))
              .map((p) => p.amount),
          );
          return sub(b.total, paid);
        }),
    );
  }

  allPayments(): readonly ContractPayment[] {
    return this.payments;
  }

  runFor(period: PeriodKey): RecognitionRun | null {
    return this.runs.get(period) ?? null;
  }

  allBillings(): readonly BillingRecord[] {
    return this.billings;
  }

  recognizedToDate(contractId: string): Paise {
    return sum(
      this.schedule(contractId)
        .filter((l) => this.recognized.has(this.key(l.obligationId, l.period)))
        .map((l) => l.amount),
    );
  }

  billedToDate(contractId: string): Paise {
    return sum(this.billings.filter((b) => b.contractId === contractId).map((b) => b.net));
  }

  /** Contract liability: billed ahead of recognition. Zero when negative. */
  deferredBalanceOf(contractId: string): Paise {
    const d = sub(this.billedToDate(contractId), this.recognizedToDate(contractId));
    return d > ZERO ? d : ZERO;
  }

  /** Contract asset: recognised ahead of billing. Zero when negative. */
  unbilledBalanceOf(contractId: string): Paise {
    const d = sub(this.recognizedToDate(contractId), this.billedToDate(contractId));
    return d > ZERO ? d : ZERO;
  }

  private key(obligationId: string, period: PeriodKey): string {
    return `${obligationId}|${period}`;
  }
}

const dateBefore = (iso: string): string =>
  new Date(Date.parse(iso + "T00:00:00Z") - 86_400_000).toISOString().slice(0, 10);
