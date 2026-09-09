/**
 * Payment reminders — drafted, never sent.
 *
 * Lives on its own because two callers now need the identical draft: the AI
 * tool, when someone asks it to chase an invoice, and the CFO agent, when it
 * finds one going bad on its own. Two copies of this would be two reminder
 * letters with the same job and slowly different wording — and, worse, two
 * places where "we already drafted this" is decided.
 */

import { Organization } from "./organization.js";
import { PendingAction } from "./actions.js";
import { formatINR } from "./money.js";

export const REMINDER_KIND = "payment_reminder";

/** The one line a person sees on the approve row — and the dedupe key. */
export const reminderSummary = (customer: string, number: string): string =>
  `Send a reminder to ${customer} for ${number}`;

/**
 * Draft a reminder for one overdue invoice.
 *
 * Throws when the invoice is not actually overdue as of the date: an agent
 * chasing a customer who paid is the failure mode that ends the trust in
 * every other message it sends.
 */
export const draftPaymentReminder = (
  org: Organization,
  invoiceNumber: string,
  asOf: string,
  proposedBy = "cfo-agent",
): PendingAction => {
  const overdue = org.invoices.overdue(asOf).find((o) => o.invoice.number === invoiceNumber);
  if (!overdue) throw new Error(`Invoice ${invoiceNumber} is not overdue as of ${asOf}`);

  const { invoice, outstanding, daysOverdue } = overdue;
  const body =
    `Subject: ${invoice.number} — payment overdue by ${daysOverdue} days\n\n` +
    `Hello ${invoice.customer},\n\n` +
    `Invoice ${invoice.number} for ${formatINR(outstanding)} was due on ${invoice.dueDate} ` +
    `and is now ${daysOverdue} days overdue.\n\n` +
    `Could you confirm when payment will be made? If it has already been sent, ` +
    `please share the reference so we can match it.\n\nThank you.`;

  return org.actions.propose({
    kind: REMINDER_KIND,
    summary: reminderSummary(invoice.customer, invoice.number),
    detail: body,
    proposedBy,
    effect: () => {
      // Recorded, not transmitted: nothing here has a mail server, and
      // claiming an email was sent would be worse than not sending one.
      org.bus.emit({
        orgId: org.orgId,
        type: "invoice.reminder_drafted",
        at: new Date().toISOString(),
        actor: proposedBy,
        payload: { invoice: invoice.number, customer: invoice.customer, daysOverdue },
      });
      return `reminder for ${invoice.number} recorded against ${invoice.customer}`;
    },
  });
};
