/**
 * Accounts Payable — vendor bills with an approval workflow.
 *
 * Mirrors the AR invoice state machine, in the other direction:
 *   DRAFT → PENDING_APPROVAL → APPROVED → (PARTIALLY_PAID →) PAID
 * with REJECTED and CANCELLED as terminal states before approval.
 *
 * Approval posts DR Expense (+ DR GST input tax credit) / CR Accounts
 * Payable; payment posts DR Accounts Payable / CR Bank. Like the invoice
 * engine, a bill never stores its own balance — what is outstanding is
 * derived from recorded payments so the ledger stays the single truth.
 *
 * Approval limits are policy, enforced in code: a bill above an approver's
 * limit cannot be approved by them, and a bill can never be approved by the
 * person who created it when segregation of duties is switched on.
 */

import { Paise, ZERO, add, sub, sum, cmp, mulRatio } from "../money.js";
import { ChartOfAccounts } from "../accounts.js";
import { JournalEngine } from "../journal.js";
import { EventBus } from "../events.js";
import { daysBetween, AgingBucket } from "../invoices.js";

export type BillStatus =
  | "DRAFT"
  | "PENDING_APPROVAL"
  | "APPROVED"
  | "PARTIALLY_PAID"
  | "PAID"
  | "REJECTED"
  | "CANCELLED";

export interface BillLine {
  readonly description: string;
  readonly amount: Paise; // taxable value, strictly positive
  readonly expenseAccountId: string;
  readonly gstRatePct: number;
  /** Input tax credit is claimable only when the vendor is GST-registered. */
  readonly itcEligible: boolean;
}

export interface BillPayment {
  readonly date: string;
  readonly amount: Paise;
  readonly journalEntryId: string;
  readonly method: string;
}

export interface Bill {
  readonly id: string;
  readonly orgId: string;
  readonly number: string; // the vendor's invoice number
  readonly vendor: string;
  readonly billDate: string;
  readonly dueDate: string;
  readonly lines: readonly BillLine[];
  readonly subtotal: Paise;
  readonly gstAmount: Paise;
  readonly itcAmount: Paise; // the claimable slice of gstAmount
  readonly total: Paise;
  readonly status: BillStatus;
  readonly payments: readonly BillPayment[];
  readonly createdBy: string;
  readonly approvedBy: string | null;
  readonly approvedAt: string | null;
  readonly journalEntryId: string | null; // entry posted on approval
  /** Optional purchase-order reference for three-way matching. */
  readonly purchaseOrderId: string | null;
}

export interface PayablesAging {
  readonly asOf: string;
  readonly totalOutstanding: Paise;
  readonly buckets: readonly AgingBucket[];
}

export interface ApprovalPolicy {
  /** Per-approver ceiling; absent means unlimited. */
  readonly limits: ReadonlyMap<string, Paise>;
  /** A bill's creator may not also approve it. */
  readonly segregationOfDuties: boolean;
}

export class BillError extends Error {
  override name = "BillError";
}

export interface CreateBillInput {
  number: string;
  vendor: string;
  billDate: string;
  dueDate: string;
  lines: readonly BillLine[];
  purchaseOrderId?: string | null;
}

const VALID_GST_RATES = new Set([0, 5, 12, 18, 28]);

export class BillEngine {
  private bills = new Map<string, Bill>();
  private counter = 0;

  constructor(
    public readonly orgId: string,
    private chart: ChartOfAccounts,
    private journal: JournalEngine,
    private bus: EventBus,
    private policy: ApprovalPolicy = { limits: new Map(), segregationOfDuties: true },
    private accounts = { ap: "acc_ap", itc: "acc_gst_itc", bank: "acc_bank" },
  ) {
    if (chart.orgId !== orgId) throw new BillError("Chart of accounts belongs to a different organization");
  }

  create(input: CreateBillInput, actor: string): Bill {
    if (input.lines.length === 0) throw new BillError("A bill needs at least one line");
    for (const l of input.lines) {
      if (l.amount <= 0n) throw new BillError(`Line amount must be positive ("${l.description}")`);
      if (!VALID_GST_RATES.has(l.gstRatePct))
        throw new BillError(`Invalid GST rate ${l.gstRatePct}% ("${l.description}")`);
      const acct = this.chart.get(l.expenseAccountId);
      if (acct.type !== "EXPENSE" && acct.type !== "ASSET")
        throw new BillError(`"${acct.name}" is ${acct.type}; a bill line must hit an EXPENSE or ASSET account`);
    }
    if (input.dueDate < input.billDate) throw new BillError("Due date cannot precede the bill date");
    if (this.all().some((b) => b.vendor === input.vendor && b.number === input.number && b.status !== "CANCELLED"))
      throw new BillError(`Duplicate bill: ${input.vendor} invoice ${input.number} is already recorded`);

    const subtotal = sum(input.lines.map((l) => l.amount));
    const gstAmount = sum(input.lines.map((l) => mulRatio(l.amount, BigInt(l.gstRatePct), 100n)));
    const itcAmount = sum(
      input.lines.filter((l) => l.itcEligible).map((l) => mulRatio(l.amount, BigInt(l.gstRatePct), 100n)),
    );

    const bill: Bill = {
      id: `bill_${this.orgId}_${++this.counter}`,
      orgId: this.orgId,
      number: input.number,
      vendor: input.vendor,
      billDate: input.billDate,
      dueDate: input.dueDate,
      lines: input.lines.map((l) => Object.freeze({ ...l })),
      subtotal,
      gstAmount,
      itcAmount,
      total: add(subtotal, gstAmount),
      status: "DRAFT",
      payments: [],
      createdBy: actor,
      approvedBy: null,
      approvedAt: null,
      journalEntryId: null,
      purchaseOrderId: input.purchaseOrderId ?? null,
    };
    this.bills.set(bill.id, bill);
    this.emit("bill.created", actor, { billId: bill.id, vendor: bill.vendor, total: bill.total.toString() });
    return bill;
  }

  submit(billId: string, actor: string): Bill {
    const b = this.get(billId);
    if (b.status !== "DRAFT") throw new BillError(`Only DRAFT bills can be submitted (${billId} is ${b.status})`);
    return this.set(b, { status: "PENDING_APPROVAL" }, "bill.submitted", actor, { billId });
  }

  /**
   * Approval posts the liability. The approver must be within their limit
   * and, under segregation of duties, may not be the bill's creator.
   */
  approve(billId: string, approver: string): Bill {
    const b = this.get(billId);
    if (b.status !== "PENDING_APPROVAL")
      throw new BillError(`Only bills pending approval can be approved (${billId} is ${b.status})`);
    if (this.policy.segregationOfDuties && approver === b.createdBy)
      throw new BillError(`${approver} created this bill and cannot also approve it (segregation of duties)`);
    const limit = this.policy.limits.get(approver);
    if (limit !== undefined && cmp(b.total, limit) > 0)
      throw new BillError(`Bill total exceeds ${approver}'s approval limit — escalate to a higher approver`);

    const byAccount = new Map<string, Paise>();
    for (const l of b.lines) {
      // GST that cannot be claimed as ITC is part of the cost of the expense.
      const blocked = l.itcEligible ? ZERO : mulRatio(l.amount, BigInt(l.gstRatePct), 100n);
      byAccount.set(l.expenseAccountId, add(byAccount.get(l.expenseAccountId) ?? ZERO, add(l.amount, blocked)));
    }

    const entry = this.journal.post({
      date: b.billDate,
      narration: `Bill ${b.number} from ${b.vendor}`,
      lines: [
        ...[...byAccount.entries()].map(([accountId, amount]) => ({
          accountId,
          side: "DEBIT" as const,
          amount,
        })),
        ...(b.itcAmount > 0n ? [{ accountId: this.accounts.itc, side: "DEBIT" as const, amount: b.itcAmount }] : []),
        { accountId: this.accounts.ap, side: "CREDIT" as const, amount: b.total },
      ],
      sourceModule: "bill",
      referenceId: b.id,
      createdBy: approver,
    });

    return this.set(
      b,
      { status: "APPROVED", approvedBy: approver, approvedAt: new Date().toISOString(), journalEntryId: entry.id },
      "bill.approved",
      approver,
      { billId: b.id, entryId: entry.id, total: b.total.toString() },
    );
  }

  reject(billId: string, actor: string, reason: string): Bill {
    const b = this.get(billId);
    if (b.status !== "PENDING_APPROVAL")
      throw new BillError(`Only bills pending approval can be rejected (${billId} is ${b.status})`);
    return this.set(b, { status: "REJECTED" }, "bill.rejected", actor, { billId, reason });
  }

  /** DR Accounts Payable / CR Bank. Never initiated by the AI. */
  recordPayment(billId: string, date: string, amount: Paise, actor: string, method = "bank transfer", bankAccountId?: string): Bill {
    const b = this.get(billId);
    if (b.status !== "APPROVED" && b.status !== "PARTIALLY_PAID")
      throw new BillError(`Cannot pay a ${b.status} bill`);
    if (amount <= 0n) throw new BillError("Payment amount must be positive");
    const outstanding = this.outstanding(b);
    if (cmp(amount, outstanding) > 0)
      throw new BillError(`Payment exceeds outstanding balance (${amount} > ${outstanding})`);

    const entry = this.journal.post({
      date,
      narration: `Payment to ${b.vendor} for bill ${b.number}`,
      lines: [
        { accountId: this.accounts.ap, side: "DEBIT", amount },
        { accountId: bankAccountId ?? this.accounts.bank, side: "CREDIT", amount },
      ],
      sourceModule: "bill",
      referenceId: b.id,
      createdBy: actor,
    });

    const payments = [...b.payments, { date, amount, journalEntryId: entry.id, method }];
    const paid = sum(payments.map((p) => p.amount));
    const status: BillStatus = paid === b.total ? "PAID" : "PARTIALLY_PAID";
    return this.set(b, { payments, status }, "bill.paid", actor, {
      billId: b.id,
      amount: amount.toString(),
      status,
    });
  }

  cancel(billId: string, actor: string, reason: string): Bill {
    const b = this.get(billId);
    if (b.status === "APPROVED" || b.status === "PARTIALLY_PAID" || b.status === "PAID")
      throw new BillError(`Bill ${billId} is ${b.status}; reverse its journal entry instead of cancelling`);
    return this.set(b, { status: "CANCELLED" }, "bill.cancelled", actor, { billId, reason });
  }

  get(billId: string): Bill {
    const b = this.bills.get(billId);
    if (!b) throw new BillError(`Unknown bill ${billId}`);
    return b;
  }

  all(): readonly Bill[] {
    return [...this.bills.values()];
  }

  pendingApproval(): readonly Bill[] {
    return this.all().filter((b) => b.status === "PENDING_APPROVAL");
  }

  outstanding(b: Bill): Paise {
    if (b.status === "APPROVED" || b.status === "PARTIALLY_PAID") {
      return sub(b.total, sum(b.payments.map((p) => p.amount)));
    }
    return ZERO;
  }

  /** Bills already due and still unpaid — the cash the business owes now. */
  overdue(asOf: string): readonly { bill: Bill; outstanding: Paise; daysOverdue: number }[] {
    return this.all()
      .filter((b) => (b.status === "APPROVED" || b.status === "PARTIALLY_PAID") && b.dueDate < asOf)
      .map((bill) => ({
        bill,
        outstanding: this.outstanding(bill),
        daysOverdue: daysBetween(bill.dueDate, asOf),
      }))
      .sort((a, b) => b.daysOverdue - a.daysOverdue);
  }

  aging(asOf: string): PayablesAging {
    const open = this.all().filter(
      (b) => (b.status === "APPROVED" || b.status === "PARTIALLY_PAID") && this.outstanding(b) > 0n,
    );
    const defs: Array<[string, (d: number) => boolean]> = [
      ["Current", (d) => d <= 0],
      ["1-30 days", (d) => d >= 1 && d <= 30],
      ["31-60 days", (d) => d >= 31 && d <= 60],
      ["60+ days", (d) => d > 60],
    ];
    const buckets = defs.map(([label, match]) => {
      const inBucket = open.filter((b) => match(daysBetween(b.dueDate, asOf)));
      return { label, count: inBucket.length, amount: sum(inBucket.map((b) => this.outstanding(b))) };
    });
    return { asOf, totalOutstanding: sum(open.map((b) => this.outstanding(b))), buckets };
  }

  private set(
    b: Bill,
    patch: Partial<Bill>,
    event: string,
    actor: string,
    payload: Record<string, unknown>,
  ): Bill {
    const next: Bill = { ...b, ...patch };
    this.bills.set(b.id, next);
    this.emit(event, actor, payload);
    return next;
  }

  private emit(type: string, actor: string, payload: Record<string, unknown>): void {
    this.bus.emit({ orgId: this.orgId, type, at: new Date().toISOString(), actor, payload });
  }
}
