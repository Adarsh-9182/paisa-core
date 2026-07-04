/**
 * Invoice Engine — a state machine that emits journal entries on transitions.
 *
 * Lifecycle: DRAFT → SENT → (PARTIALLY_PAID →) PAID, or DRAFT → CANCELLED.
 * Sending posts DR Accounts Receivable / CR Revenue (+ CR GST Payable);
 * payments post DR Bank / CR Accounts Receivable. The invoice itself never
 * stores a balance — outstanding amounts are derived from recorded payments,
 * and the ledger stays the single source of truth.
 */

import { Paise, ZERO, add, sub, sum, mulRatio } from "./money.js";
import { ChartOfAccounts } from "./accounts.js";
import { JournalEngine } from "./journal.js";
import { EventBus } from "./events.js";

export type InvoiceStatus = "DRAFT" | "SENT" | "PARTIALLY_PAID" | "PAID" | "CANCELLED";

export interface InvoiceLine {
  readonly description: string;
  readonly amount: Paise; // taxable value, strictly positive
  readonly gstRatePct: number; // 0 | 5 | 12 | 18 | 28
}

export interface InvoicePayment {
  readonly date: string;
  readonly amount: Paise;
  readonly journalEntryId: string;
}

export interface Invoice {
  readonly id: string;
  readonly orgId: string;
  readonly number: string;
  readonly customer: string;
  readonly issueDate: string;
  readonly dueDate: string;
  readonly lines: readonly InvoiceLine[];
  readonly subtotal: Paise;
  readonly gstAmount: Paise;
  readonly total: Paise;
  readonly status: InvoiceStatus;
  readonly payments: readonly InvoicePayment[];
  readonly revenueAccountId: string;
  readonly journalEntryId: string | null; // entry posted on send
}

export interface AgingBucket {
  readonly label: string;
  readonly count: number;
  readonly amount: Paise;
}

export interface ReceivablesAging {
  readonly asOf: string;
  readonly totalOutstanding: Paise;
  readonly buckets: readonly AgingBucket[];
}

export interface OverdueInvoice {
  readonly invoice: Invoice;
  readonly outstanding: Paise;
  readonly daysOverdue: number;
}

export class InvoiceError extends Error {
  override name = "InvoiceError";
}

export interface CreateInvoiceInput {
  number: string;
  customer: string;
  issueDate: string;
  dueDate: string;
  lines: readonly InvoiceLine[];
  revenueAccountId?: string;
}

const VALID_GST_RATES = new Set([0, 5, 12, 18, 28]);

export const daysBetween = (fromISO: string, toISO: string): number =>
  Math.round((Date.parse(toISO + "T00:00:00Z") - Date.parse(fromISO + "T00:00:00Z")) / 86_400_000);

export class InvoiceEngine {
  private invoices = new Map<string, Invoice>();
  private counter = 0;

  constructor(
    public readonly orgId: string,
    private chart: ChartOfAccounts,
    private journal: JournalEngine,
    private bus: EventBus,
  ) {
    if (chart.orgId !== orgId) throw new InvoiceError("Chart of accounts belongs to a different organization");
  }

  create(input: CreateInvoiceInput, actor: string): Invoice {
    if (input.lines.length === 0) throw new InvoiceError("An invoice needs at least one line");
    for (const l of input.lines) {
      if (l.amount <= 0n) throw new InvoiceError(`Line amount must be positive ("${l.description}")`);
      if (!VALID_GST_RATES.has(l.gstRatePct))
        throw new InvoiceError(`Invalid GST rate ${l.gstRatePct}% ("${l.description}")`);
    }
    if (input.dueDate < input.issueDate) throw new InvoiceError("Due date cannot precede issue date");
    const revenueAccountId = input.revenueAccountId ?? "acc_services";
    const revenueAccount = this.chart.get(revenueAccountId);
    if (revenueAccount.type !== "REVENUE")
      throw new InvoiceError(`Account ${revenueAccountId} is not a revenue account`);

    const subtotal = sum(input.lines.map((l) => l.amount));
    const gstAmount = sum(
      input.lines.map((l) => mulRatio(l.amount, BigInt(l.gstRatePct), 100n)),
    );
    const invoice: Invoice = {
      id: `inv_${this.orgId}_${++this.counter}`,
      orgId: this.orgId,
      number: input.number,
      customer: input.customer,
      issueDate: input.issueDate,
      dueDate: input.dueDate,
      lines: input.lines.map((l) => Object.freeze({ ...l })),
      subtotal,
      gstAmount,
      total: add(subtotal, gstAmount),
      status: "DRAFT",
      payments: [],
      revenueAccountId,
      journalEntryId: null,
    };
    this.invoices.set(invoice.id, invoice);
    this.emit("invoice.created", actor, { invoiceId: invoice.id, number: invoice.number, customer: invoice.customer });
    return invoice;
  }

  /** DRAFT → SENT. Posts DR AR / CR Revenue (+ CR GST Payable). */
  send(invoiceId: string, actor: string): Invoice {
    const inv = this.get(invoiceId);
    if (inv.status !== "DRAFT") throw new InvoiceError(`Only DRAFT invoices can be sent (${invoiceId} is ${inv.status})`);
    const lines = [
      { accountId: "acc_ar", side: "DEBIT" as const, amount: inv.total },
      { accountId: inv.revenueAccountId, side: "CREDIT" as const, amount: inv.subtotal },
      ...(inv.gstAmount > 0n
        ? [{ accountId: "acc_gst_payable", side: "CREDIT" as const, amount: inv.gstAmount }]
        : []),
    ];
    const entry = this.journal.post({
      date: inv.issueDate,
      narration: `Invoice ${inv.number} to ${inv.customer}`,
      lines,
      sourceModule: "invoice",
      referenceId: inv.id,
      createdBy: actor,
    });
    const next: Invoice = { ...inv, status: "SENT", journalEntryId: entry.id };
    this.invoices.set(inv.id, next);
    this.emit("invoice.sent", actor, { invoiceId: inv.id, number: inv.number, entryId: entry.id });
    return next;
  }

  /** Record a (possibly partial) payment. Posts DR Bank / CR AR. */
  recordPayment(invoiceId: string, date: string, amount: Paise, actor: string, bankAccountId = "acc_bank"): Invoice {
    const inv = this.get(invoiceId);
    if (inv.status !== "SENT" && inv.status !== "PARTIALLY_PAID")
      throw new InvoiceError(`Cannot record payment on a ${inv.status} invoice`);
    if (amount <= 0n) throw new InvoiceError("Payment amount must be positive");
    const outstanding = this.outstanding(inv);
    if (amount > outstanding)
      throw new InvoiceError(`Payment exceeds outstanding balance (${amount} > ${outstanding})`);

    const entry = this.journal.post({
      date,
      narration: `Payment for invoice ${inv.number} from ${inv.customer}`,
      lines: [
        { accountId: bankAccountId, side: "DEBIT", amount },
        { accountId: "acc_ar", side: "CREDIT", amount },
      ],
      sourceModule: "invoice",
      referenceId: inv.id,
      createdBy: actor,
    });
    const payments = [...inv.payments, { date, amount, journalEntryId: entry.id }];
    const paid = sum(payments.map((p) => p.amount));
    const status: InvoiceStatus = paid === inv.total ? "PAID" : "PARTIALLY_PAID";
    const next: Invoice = { ...inv, payments, status };
    this.invoices.set(inv.id, next);
    this.emit("invoice.payment", actor, { invoiceId: inv.id, amount: amount.toString(), status });
    return next;
  }

  /** Only DRAFT invoices can be cancelled; sent invoices need a journal reversal. */
  cancel(invoiceId: string, actor: string, reason: string): Invoice {
    const inv = this.get(invoiceId);
    if (inv.status !== "DRAFT")
      throw new InvoiceError(`Only DRAFT invoices can be cancelled; reverse the journal entry for ${inv.status} invoices`);
    const next: Invoice = { ...inv, status: "CANCELLED" };
    this.invoices.set(inv.id, next);
    this.emit("invoice.cancelled", actor, { invoiceId: inv.id, reason });
    return next;
  }

  get(invoiceId: string): Invoice {
    const inv = this.invoices.get(invoiceId);
    if (!inv) throw new InvoiceError(`Unknown invoice ${invoiceId}`);
    return inv;
  }

  all(): readonly Invoice[] {
    return [...this.invoices.values()];
  }

  outstanding(inv: Invoice): Paise {
    if (inv.status === "DRAFT" || inv.status === "CANCELLED") return ZERO;
    return sub(inv.total, sum(inv.payments.map((p) => p.amount)));
  }

  overdue(asOf: string): readonly OverdueInvoice[] {
    return this.all()
      .filter((i) => (i.status === "SENT" || i.status === "PARTIALLY_PAID") && i.dueDate < asOf)
      .map((invoice) => ({
        invoice,
        outstanding: this.outstanding(invoice),
        daysOverdue: daysBetween(invoice.dueDate, asOf),
      }))
      .sort((a, b) => b.daysOverdue - a.daysOverdue);
  }

  aging(asOf: string): ReceivablesAging {
    const open = this.all().filter(
      (i) => (i.status === "SENT" || i.status === "PARTIALLY_PAID") && this.outstanding(i) > 0n,
    );
    const bucketDefs: Array<[string, (days: number) => boolean]> = [
      ["Current", (d) => d <= 0],
      ["1-30 days", (d) => d >= 1 && d <= 30],
      ["31-60 days", (d) => d >= 31 && d <= 60],
      ["60+ days", (d) => d > 60],
    ];
    const buckets = bucketDefs.map(([label, match]) => {
      const inBucket = open.filter((i) => match(daysBetween(i.dueDate, asOf)));
      return {
        label,
        count: inBucket.length,
        amount: sum(inBucket.map((i) => this.outstanding(i))),
      };
    });
    return {
      asOf,
      totalOutstanding: sum(open.map((i) => this.outstanding(i))),
      buckets,
    };
  }

  private emit(type: string, actor: string, payload: Record<string, unknown>): void {
    this.bus.emit({ orgId: this.orgId, type, at: new Date().toISOString(), actor, payload });
  }
}
