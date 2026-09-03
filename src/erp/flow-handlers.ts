/**
 * The handlers behind the standard flows.
 *
 * `flows.ts` decides when something runs. This decides what it does, by
 * calling the engines that already exist — no flow reimplements accounting it
 * can ask the ledger for.
 *
 * There are two kinds of flow here, and the difference is the whole reason
 * this file can post at all:
 *
 *   - **Executing flows** run a schedule a human already approved. When a
 *     prepaid was set up, the amount, the periods and the accounts were
 *     decided and signed off; posting September's slice is arithmetic on that
 *     decision, not a new one. `runAmortization` and `recognize` are already
 *     idempotent per period, so re-running is safe and the flow adds a clock,
 *     not a judgement.
 *   - **Judging flows** decide something deserves a human's attention — an
 *     unusual amount, a receivable going bad, a bill from a vendor nobody has
 *     seen before. These raise proposals and never post. Approval posts, and
 *     the approval is attributed.
 *
 * Marking an executing flow as judging would bury mechanical postings in a
 * review queue nobody can clear; marking a judging flow as executing would
 * let a rule post to the ledger unattended. So the two lists are explicit in
 * `flow-catalog.ts` and a test compares them.
 */

import { formatINR, paise, Paise, ZERO, add, cmp } from "../money.js";
import type { ErpSuite } from "./suite.js";
import type { Organization } from "../organization.js";
import type { FlowHandler, FlowOutcome, FlowRegistry } from "./flows.js";
import { FLOW_TASKS } from "./flow-catalog.js";

/** What a handler is allowed to reach. */
export interface HandlerDeps {
  readonly org: Organization;
  readonly erp: ErpSuite;
  /** Attributed on every posting a flow makes. */
  readonly actor: string;
}

const num = (params: Readonly<Record<string, unknown>> | undefined, key: string, fallback: number): number => {
  const v = params?.[key];
  return typeof v === "number" && Number.isFinite(v) ? v : fallback;
};

const paiseParam = (params: Readonly<Record<string, unknown>> | undefined, key: string, fallback: Paise): Paise => {
  const v = params?.[key];
  if (typeof v === "bigint") return paise(v);
  if (typeof v === "number" && Number.isInteger(v)) return paise(v);
  return fallback;
};

/* ------------------------------------------------------------------ */
/* Executing flows — a schedule a human already approved                */
/* ------------------------------------------------------------------ */

const prepaidAmortisation =
  ({ erp, actor }: HandlerDeps): FlowHandler =>
  ({ occurrence }): FlowOutcome => {
    // The occurrence's own period, not today's. A catch-up run for May must
    // post May's slice, which is exactly why `catchUp: "each"` exists.
    const result = erp.schedules.runAmortization(occurrence.period, actor);
    if (result.itemCount === 0) return { summary: `No prepaid amortisation due for ${occurrence.period}` };
    return {
      summary:
        `Amortised ${result.itemCount} prepaid${result.itemCount === 1 ? "" : "s"} for ` +
        `${occurrence.period} — ${formatINR(result.amount)}`,
    };
  };

const deferredRevenue =
  ({ erp, actor }: HandlerDeps): FlowHandler =>
  ({ occurrence }): FlowOutcome => {
    const run = erp.revrec.recognize(occurrence.period, actor);
    if (!run) return { summary: `No revenue to recognise for ${occurrence.period}` };
    return { summary: `Recognised revenue for ${occurrence.period} — ${formatINR(run.amount)}` };
  };

/* ------------------------------------------------------------------ */
/* Judging flows — raise a proposal, never post                        */
/* ------------------------------------------------------------------ */

const preCloseScan =
  ({ erp, actor }: HandlerDeps): FlowHandler =>
  ({ occurrence }): FlowOutcome => {
    // Scan the period that just ended: on the 1st of September, the month
    // anyone is closing is August. Scanning September would find a period
    // one day old and report nothing.
    const period = priorPeriod(occurrence.period);
    const raised = erp.agents.scan(period, actor);
    const open = erp.agents.open().length;
    return {
      summary:
        raised.length === 0
          ? `Pre-close scan of ${period} found nothing new (${open} still open)`
          : `Pre-close scan of ${period} raised ${raised.length} for review (${open} open)`,
      proposalIds: raised.map((p) => p.id),
    };
  };

const controlMonitor =
  ({ erp, actor }: HandlerDeps): FlowHandler =>
  ({ occurrence, flow }): FlowOutcome => {
    const threshold = paiseParam(flow.params, "thresholdPaise", paise(10_00_000_00n));
    // `scan` dedupes on kind, period and title, and leaves a decided proposal
    // decided — so running this daily raises each finding once, not thirty times.
    const raised = erp.agents.scan(occurrence.period, actor);
    const large = raised.filter((p) => p.amount !== null && cmp(abs(p.amount), threshold) >= 0);
    return {
      summary:
        raised.length === 0
          ? `Nothing new in ${occurrence.period}`
          : `${raised.length} new finding${raised.length === 1 ? "" : "s"} in ${occurrence.period}` +
            (large.length ? `, ${large.length} over ${formatINR(threshold)}` : ""),
      proposalIds: raised.map((p) => p.id),
    };
  };

/* ------------------------------------------------------------------ */
/* Reporting flows — read, summarise, post nothing                     */
/* ------------------------------------------------------------------ */

const arReminders =
  ({ org, erp: _erp }: HandlerDeps): FlowHandler =>
  ({ occurrence, flow }): FlowOutcome => {
    const minDays = num(flow.params, "minOverdueDays", 30);
    const minCount = num(flow.params, "minUnpaidInvoices", 2);
    const overdue = org.invoices.overdue(occurrence.scheduledFor).filter((o) => o.daysOverdue >= minDays);

    const byCustomer = new Map<string, { count: number; total: Paise }>();
    for (const o of overdue) {
      const key = o.invoice.customer;
      const prev = byCustomer.get(key) ?? { count: 0, total: ZERO };
      byCustomer.set(key, { count: prev.count + 1, total: add(prev.total, o.outstanding) });
    }

    // One reminder per customer, not one per invoice: a customer with six
    // overdue invoices gets a single consolidated chase, which is the
    // difference between a reminder and a nuisance.
    const chase = [...byCustomer.entries()].filter(([, v]) => v.count >= minCount);
    if (chase.length === 0) return { summary: `No customer has ${minCount}+ invoices over ${minDays} days` };

    const total = chase.reduce((acc, [, v]) => add(acc, v.total), ZERO);
    return {
      summary:
        `${chase.length} customer${chase.length === 1 ? "" : "s"} to chase — ` +
        `${formatINR(total)} across ${chase.reduce((n, [, v]) => n + v.count, 0)} invoices`,
    };
  };

const badDebt =
  ({ org }: HandlerDeps): FlowHandler =>
  ({ occurrence, flow }): FlowOutcome => {
    const days = num(flow.params, "overdueDays", 90);
    const stale = org.invoices.overdue(occurrence.scheduledFor).filter((o) => o.daysOverdue >= days);
    if (stale.length === 0) return { summary: `Nothing outstanding beyond ${days} days` };
    const total = stale.reduce((acc, o) => add(acc, o.outstanding), ZERO);
    return {
      summary:
        `${stale.length} invoice${stale.length === 1 ? "" : "s"} over ${days} days — ` +
        `${formatINR(total)} to assess for provision`,
    };
  };

const cashForecast =
  ({ org }: HandlerDeps): FlowHandler =>
  ({ occurrence, flow }): FlowOutcome => {
    const weeks = num(flow.params, "weeks", 13);
    const cash = org.cashflow.cashOnHand(occurrence.scheduledFor);
    const m = org.cashflow.metrics(occurrence.scheduledFor);
    return {
      summary:
        `${weeks}-week outlook from ${occurrence.scheduledFor}: ${formatINR(cash)} on hand` +
        (m.monthlyNetBurn === null ? ", burn not yet measurable" : `, ${formatINR(m.monthlyNetBurn)} monthly net burn`) +
        (m.runwayDays === null ? ", runway not applicable" : `, ${Math.round(m.runwayDays)} days runway`),
    };
  };

const cfoDigest =
  ({ org, erp }: HandlerDeps): FlowHandler =>
  ({ occurrence }): FlowOutcome => {
    const cash = org.cashflow.cashOnHand(occurrence.scheduledFor);
    const arr = erp.metrics.arr(occurrence.period);
    const open = erp.agents.open().length;
    return {
      summary:
        `Week to ${occurrence.scheduledFor}: ${formatINR(arr)} ARR, ${formatINR(cash)} cash, ` +
        `${open} item${open === 1 ? "" : "s"} awaiting review`,
    };
  };

const boardSummary =
  ({ org, erp }: HandlerDeps): FlowHandler =>
  ({ occurrence }): FlowOutcome => {
    const period = priorPeriod(occurrence.period);
    const arr = erp.metrics.arr(period);
    const movement = erp.metrics.movement(period);
    const cash = org.cashflow.cashOnHand(occurrence.scheduledFor);
    return {
      summary:
        `Quarter to ${period}: ${formatINR(arr)} ARR ` +
        `(new ${formatINR(movement.newMrr)}, churn ${formatINR(movement.churnedMrr)}), ` +
        `${formatINR(cash)} cash`,
    };
  };

const vendorBillAlert =
  ({ erp }: HandlerDeps): FlowHandler =>
  ({ occurrence, flow }): FlowOutcome => {
    const threshold = paiseParam(flow.params, "thresholdPaise", paise(25_00_000_00n));
    const pending = erp.bills.pendingApproval();
    const large = pending.filter((b) => cmp(erp.bills.outstanding(b), threshold) >= 0);
    if (pending.length === 0) return { summary: "No bills awaiting approval" };
    return {
      summary:
        `${pending.length} bill${pending.length === 1 ? "" : "s"} awaiting approval as of ` +
        `${occurrence.scheduledFor}` +
        (large.length ? `, ${large.length} over ${formatINR(threshold)}` : ""),
    };
  };

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

const abs = (v: Paise): Paise => (v < 0n ? paise(-v) : v);

/** The period before the one given, e.g. "2026-01" → "2025-12". */
const priorPeriod = (period: string): string => {
  const [y, m] = period.split("-").map(Number) as [number, number];
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, "0")}`;
};

/* ------------------------------------------------------------------ */
/* Registry                                                            */
/* ------------------------------------------------------------------ */

/**
 * Bind every standard task to a handler.
 *
 * A task with no handler fails its occurrence rather than skipping it, so a
 * flow enabled before its handler ships retries once deployed instead of
 * being recorded as done. That is `runDue`'s behaviour, relied on here.
 */
export const standardHandlers = (deps: HandlerDeps): FlowRegistry =>
  new Map<string, FlowHandler>([
    [FLOW_TASKS.prepaidAmortisation, prepaidAmortisation(deps)],
    [FLOW_TASKS.deferredRevenue, deferredRevenue(deps)],
    [FLOW_TASKS.preCloseScan, preCloseScan(deps)],
    [FLOW_TASKS.controlMonitor, controlMonitor(deps)],
    [FLOW_TASKS.arReminders, arReminders(deps)],
    [FLOW_TASKS.badDebt, badDebt(deps)],
    [FLOW_TASKS.cashForecast, cashForecast(deps)],
    [FLOW_TASKS.cfoDigest, cfoDigest(deps)],
    [FLOW_TASKS.boardSummary, boardSummary(deps)],
    [FLOW_TASKS.vendorBillAlert, vendorBillAlert(deps)],
  ]);
