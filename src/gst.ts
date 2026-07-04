/**
 * GST Engine — deterministic Indian GST intelligence.
 *
 * Output tax comes from invoices raised in the period; input tax credit
 * comes from the GST ITC ledger account (posted by banking/purchase
 * ingestion). Net liability = output − ITC, floored at zero. Filing
 * deadlines (GSTR-1 on the 11th, GSTR-3B on the 20th of the following
 * month) are calendar arithmetic, not AI output.
 */

import { Paise, ZERO, add, sub, sum } from "./money.js";
import { Ledger } from "./ledger.js";
import { InvoiceEngine, daysBetween } from "./invoices.js";

export interface GstPosition {
  readonly periodFrom: string;
  readonly periodTo: string;
  readonly outputTax: Paise; // GST collected on invoices raised in the period
  readonly inputTaxCredit: Paise; // ITC accrued in the period
  readonly netPayable: Paise; // max(output − ITC, 0)
  readonly unusedCredit: Paise; // max(ITC − output, 0)
  readonly gstPayableBalance: Paise; // ledger balance of GST Payable as of periodTo
}

export interface GstFiling {
  readonly form: "GSTR-1" | "GSTR-3B";
  readonly period: string; // "2026-06" — the month being reported
  readonly dueDate: string;
  readonly daysLeft: number; // negative = overdue
  readonly note: string;
}

export class GstEngine {
  constructor(
    public readonly orgId: string,
    private ledger: Ledger,
    private invoices: InvoiceEngine,
  ) {}

  position(periodFrom: string, periodTo: string): GstPosition {
    const raised = this.invoices
      .all()
      .filter(
        (i) =>
          i.status !== "DRAFT" &&
          i.status !== "CANCELLED" &&
          i.issueDate >= periodFrom &&
          i.issueDate <= periodTo,
      );
    const outputTax = sum(raised.map((i) => i.gstAmount));
    const itcEnd = safeBalance(this.ledger, "acc_gst_itc", periodTo);
    const itcStart = safeBalance(this.ledger, "acc_gst_itc", dayBefore(periodFrom));
    const inputTaxCredit = sub(itcEnd, itcStart);
    const net = sub(outputTax, inputTaxCredit);
    return {
      periodFrom,
      periodTo,
      outputTax,
      inputTaxCredit,
      netPayable: net > 0n ? net : ZERO,
      unusedCredit: net < 0n ? sub(ZERO, net) : ZERO,
      gstPayableBalance: safeBalance(this.ledger, "acc_gst_payable", periodTo),
    };
  }

  /** Recently-overdue filings plus the next `count` upcoming ones, sorted by due date. */
  upcomingFilings(asOf: string, count = 4): readonly GstFiling[] {
    const [y, m] = asOf.split("-").map(Number) as [number, number];
    const all: GstFiling[] = [];
    // Reported months from two back to `count` forward cover every filing that can matter.
    for (let offset = -2; offset <= count; offset++) {
      const total = y * 12 + (m - 1) + offset;
      const py = Math.floor(total / 12);
      const pm = ((total % 12) + 12) % 12; // reported month, 0-indexed
      const period = `${py}-${String(pm + 1).padStart(2, "0")}`;
      const due = (day: number): string => {
        const dTotal = total + 1; // due in the following month
        const dy = Math.floor(dTotal / 12);
        const dm = ((dTotal % 12) + 12) % 12;
        return `${dy}-${String(dm + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
      };
      const forms: Array<["GSTR-1" | "GSTR-3B", number, string]> = [
        ["GSTR-1", 11, "Outward supplies statement"],
        ["GSTR-3B", 20, "Summary return and tax payment"],
      ];
      for (const [form, day, note] of forms) {
        const dueDate = due(day);
        all.push({ form, period, dueDate, daysLeft: daysBetween(asOf, dueDate), note });
      }
    }
    all.sort((a, b) => (a.dueDate < b.dueDate ? -1 : 1));
    const overdue = all.filter((f) => f.daysLeft < 0 && f.daysLeft >= -45); // older = assume filed
    const upcoming = all.filter((f) => f.daysLeft >= 0).slice(0, count);
    return [...overdue, ...upcoming];
  }
}

const dayBefore = (iso: string): string => {
  const d = new Date(iso + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
};

const safeBalance = (ledger: Ledger, accountId: string, asOf: string): Paise => {
  try {
    return ledger.balance(accountId, asOf);
  } catch {
    return ZERO;
  }
};
