/**
 * ERP tools for the AI CFO — the Rillet "Aura assistant" surface.
 *
 * Same contract as the core tools in ../ai/tools.ts: each one calls the
 * deterministic engines and returns a structured string, so every figure the
 * model narrates survives verifyNarration() by construction. The model picks
 * which question to ask; it never computes an answer.
 *
 * These tools are read-only by design. Recognition, billing, close and
 * approval all mutate the ledger, so they stay behind explicit human action
 * in the product — the assistant can tell you the close is blocked and why,
 * but it cannot close the month for you.
 */

import { formatINR, ZERO, sum } from "../money.js";
import { Organization } from "../organization.js";
import { ToolSpec } from "../ai/tools.js";
import { ErpSuite } from "./suite.js";
import { PeriodKey } from "./periods.js";

export type ErpToolFn = (org: Organization, erp: ErpSuite, args: Record<string, unknown>) => string;

const str = (v: unknown, name: string): string => {
  if (typeof v !== "string" || v.length === 0) throw new Error(`Tool arg "${name}" must be a non-empty string`);
  return v;
};

const num = (v: unknown, name: string, fallback: number): number => {
  if (v === undefined || v === null) return fallback;
  const n = Number(v);
  if (!Number.isFinite(n)) throw new Error(`Tool arg "${name}" must be a number`);
  return Math.trunc(n);
};

const bps = (v: number | null): string => (v === null ? "n/a" : `${(v / 100).toFixed(2)}%`);

export const ERP_TOOLS: Record<string, ErpToolFn> = {
  get_close_status: (_org, erp, args) => {
    const period = str(args.period, "period") as PeriodKey;
    const run = erp.close.status(period);
    if (!run)
      return `period=${period} status=${erp.periods.status(period)} close_started=false note="The close checklist has not been run for this period yet."`;
    const rows = run.tasks
      .map((t) => `${t.id}=${t.status}${t.status === "BLOCKED" ? ` ("${t.blockers.join("; ")}")` : ""}`)
      .join(" ");
    return (
      `period=${period} period_status=${erp.periods.status(period)} passed=${run.passed} blocked=${run.blocked} ` +
      `ready_to_close=${run.readyToClose} locked=${run.locked} tasks: ${rows}`
    );
  },

  get_revenue_waterfall: (_org, erp, args) => {
    const from = str(args.fromPeriod, "fromPeriod") as PeriodKey;
    const months = num(args.months, "months", 12);
    const cells = erp.revrec.waterfall(from, months);
    const rows = cells.map((c) => `${c.period}=${formatINR(c.amount)}`).join(" ");
    return `from=${from} months=${months} total_rpo=${formatINR(erp.revrec.remainingPerformanceObligation())} waterfall: ${rows}`;
  },

  get_deferred_revenue_rollforward: (org, erp, args) => {
    const period = str(args.period, "period") as PeriodKey;
    const rf = erp.revrec.rollforward(period, (d) => org.ledger.balance("acc_deferred_revenue", d));
    return (
      `period=${period} opening=${formatINR(rf.opening)} billed=${formatINR(rf.billed)} ` +
      `recognized=${formatINR(rf.recognized)} closing=${formatINR(rf.closing)} ` +
      `ledger_closing=${formatINR(rf.ledgerClosing)} ties_to_ledger=${rf.tiesToLedger}`
    );
  },

  get_saas_metrics: (_org, erp, args) => {
    const period = str(args.period, "period") as PeriodKey;
    const m = erp.metrics.movement(period);
    return (
      `period=${period} opening_mrr=${formatINR(m.openingMrr)} new=${formatINR(m.newMrr)} ` +
      `expansion=${formatINR(m.expansionMrr)} contraction=${formatINR(m.contractionMrr)} ` +
      `churn=${formatINR(m.churnedMrr)} reactivation=${formatINR(m.reactivationMrr)} ` +
      `closing_mrr=${formatINR(m.closingMrr)} arr=${formatINR(m.arr)} customers=${m.customerCount} ` +
      `backlog_rpo=${formatINR(erp.metrics.backlog())}`
    );
  },

  get_retention: (_org, erp, args) => {
    const from = str(args.fromPeriod, "fromPeriod") as PeriodKey;
    const to = str(args.toPeriod, "toPeriod") as PeriodKey;
    const r = erp.metrics.retention(from, to);
    return (
      `cohort=${from}..${to} opening_mrr=${formatINR(r.openingMrr)} expansion=${formatINR(r.expansion)} ` +
      `contraction=${formatINR(r.contraction)} churn=${formatINR(r.churn)} closing_mrr=${formatINR(r.closingMrr)} ` +
      `nrr=${bps(r.nrrBps)} grr=${bps(r.grrBps)}`
    );
  },

  get_contract: (_org, erp, args) => {
    const number = str(args.contractNumber, "contractNumber");
    const c = erp.contracts.all().find((x) => x.number === number);
    if (!c) return `error="No contract numbered ${number}"`;
    const obligations = c.obligations
      .map((o) => `"${o.description}" method=${o.method} allocated=${formatINR(o.allocated)} ${o.startDate}..${o.endDate ?? "n/a"}`)
      .join("; ");
    return (
      `contract=${c.number} customer="${c.customer}" status=${c.status} version=${c.version} ` +
      `transaction_price=${formatINR(c.transactionPrice)} recognized_to_date=${formatINR(erp.revrec.recognizedToDate(c.id))} ` +
      `billed_to_date=${formatINR(erp.revrec.billedToDate(c.id))} deferred=${formatINR(erp.revrec.deferredBalanceOf(c.id))} ` +
      `unbilled=${formatINR(erp.revrec.unbilledBalanceOf(c.id))} obligations: ${obligations}`
    );
  },

  get_payables_aging: (_org, erp, args) => {
    const asOf = str(args.asOf, "asOf");
    const aging = erp.bills.aging(asOf);
    const buckets = aging.buckets.map((b) => `${b.label}=${formatINR(b.amount)} (${b.count})`).join(" ");
    const pending = erp.bills.pendingApproval();
    return (
      `as_of=${asOf} total_payable=${formatINR(aging.totalOutstanding)} buckets: ${buckets} ` +
      `pending_approval=${pending.length}${pending.length ? ` amount=${formatINR(sum(pending.map((b) => b.total)))}` : ""}`
    );
  },

  list_agent_proposals: (_org, erp) => {
    const open = erp.agents.open();
    if (open.length === 0) return `open_count=0 note="No open exceptions — the agents found nothing outstanding."`;
    const rows = open
      .map(
        (p) =>
          `[${p.id}] kind=${p.kind} severity=${p.severity} period=${p.period} title="${p.title}" ` +
          `amount=${p.amount ? formatINR(p.amount) : "n/a"} posts_on_approval=${p.proposedEntry !== null}`,
      )
      .join("; ");
    return `open_count=${open.length} proposals: ${rows}`;
  },

  get_flux_analysis: (_org, erp, args) => {
    const period = str(args.period, "period") as PeriodKey;
    const flux = erp.close.flux(period).slice(0, 10);
    if (flux.length === 0) return `period=${period} movements=0 note="No profit-and-loss movement against the prior period."`;
    const rows = flux
      .map(
        (f) =>
          `"${f.name}" current=${formatINR(f.current)} prior=${formatINR(f.prior)} delta=${formatINR(f.delta)} ` +
          `change=${bps(f.changeBps)} needs_explanation=${f.needsExplanation} explained=${f.explanation !== null}`,
      )
      .join("; ");
    return `period=${period} movements=${flux.length} lines: ${rows}`;
  },

  get_subledger_tie_out: (org, erp, args) => {
    const asOf = str(args.asOf, "asOf");
    const arSub = (org.invoices.aging(asOf).totalOutstanding + erp.revrec.arOutstanding(asOf)) as typeof ZERO;
    const arGl = org.ledger.balance("acc_ar", asOf);
    const apSub = erp.bills.aging(asOf).totalOutstanding;
    const apGl = org.ledger.balance("acc_ap", asOf);
    return (
      `as_of=${asOf} ar_subledger=${formatINR(arSub)} ar_ledger=${formatINR(arGl)} ar_ties=${arSub === arGl} ` +
      `ap_subledger=${formatINR(apSub)} ap_ledger=${formatINR(apGl)} ap_ties=${apSub === apGl}`
    );
  },
};

const periodArg = (desc: string) => ({ type: "string", description: `${desc} (YYYY-MM)` });
const dateArg = (desc: string) => ({ type: "string", description: `${desc} (ISO date, YYYY-MM-DD)` });

export const ERP_TOOL_SPECS: readonly ToolSpec[] = [
  {
    name: "get_close_status",
    description:
      "The month-end close checklist for a period: every task with PASSED/BLOCKED/WAIVED, what is blocking, and whether the period is ready to close or already locked. Use for any question about closing the books, what is outstanding, or why the close is stuck.",
    inputSchema: { type: "object", properties: { period: periodArg("Accounting period") }, required: ["period"], additionalProperties: false },
  },
  {
    name: "get_revenue_waterfall",
    description:
      "The deferred revenue waterfall / remaining performance obligation: contracted revenue not yet recognised, by future month. Use for backlog, RPO, or 'how much revenue is already locked in' questions.",
    inputSchema: {
      type: "object",
      properties: { fromPeriod: periodArg("First period"), months: { type: "number", description: "How many months forward (default 12)" } },
      required: ["fromPeriod"],
      additionalProperties: false,
    },
  },
  {
    name: "get_deferred_revenue_rollforward",
    description:
      "Deferred revenue roll-forward for a period — opening, billed, recognised, closing — and whether it ties to the general ledger. Use for revenue reconciliation and audit-support questions.",
    inputSchema: { type: "object", properties: { period: periodArg("Accounting period") }, required: ["period"], additionalProperties: false },
  },
  {
    name: "get_saas_metrics",
    description:
      "MRR movement bridge for a period: opening MRR, new, expansion, contraction, churn, reactivation, closing MRR, ARR, customer count and backlog. Use for ARR/MRR/churn/growth questions.",
    inputSchema: { type: "object", properties: { period: periodArg("Accounting period") }, required: ["period"], additionalProperties: false },
  },
  {
    name: "get_retention",
    description:
      "Net and gross revenue retention for a cohort between two periods, with the expansion, contraction and churn behind them. Use for NRR/GRR/retention questions.",
    inputSchema: {
      type: "object",
      properties: { fromPeriod: periodArg("Cohort start"), toPeriod: periodArg("Measurement period") },
      required: ["fromPeriod", "toPeriod"],
      additionalProperties: false,
    },
  },
  {
    name: "get_contract",
    description:
      "One revenue contract by its number: status, transaction price, each performance obligation with its ASC 606 allocation and recognition method, plus amounts recognised, billed, deferred and unbilled to date.",
    inputSchema: { type: "object", properties: { contractNumber: { type: "string", description: "Contract number, e.g. C-2026-001" } }, required: ["contractNumber"], additionalProperties: false },
  },
  {
    name: "get_payables_aging",
    description: "Accounts payable aging buckets and how many bills await approval. Use for 'what do we owe' and cash-commitment questions.",
    inputSchema: { type: "object", properties: { asOf: dateArg("As-of date") }, required: ["asOf"], additionalProperties: false },
  },
  {
    name: "list_agent_proposals",
    description:
      "Open exceptions raised by the continuous accounting agents: missing accruals, unusual amounts, probable duplicates, stale receivables, unrecognised revenue. Each says whether approving it would post an entry. Approval is always a human action.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "get_flux_analysis",
    description:
      "Period-over-period profit-and-loss variance analysis, largest movements first, flagging which ones are material enough to need a written explanation and which already have one.",
    inputSchema: { type: "object", properties: { period: periodArg("Accounting period") }, required: ["period"], additionalProperties: false },
  },
  {
    name: "get_subledger_tie_out",
    description:
      "Whether the AR and AP subledgers agree with their general-ledger control accounts as of a date. A mismatch is a close blocker — report the difference, never explain it away.",
    inputSchema: { type: "object", properties: { asOf: dateArg("As-of date") }, required: ["asOf"], additionalProperties: false },
  },
];

/** Bind the ERP tools to a suite so they match the core ToolFn signature. */
export const bindErpTools = (erp: ErpSuite): Record<string, (org: Organization, args: Record<string, unknown>) => string> =>
  Object.fromEntries(
    Object.entries(ERP_TOOLS).map(([name, fn]) => [name, (org: Organization, args: Record<string, unknown>) => fn(org, erp, args)]),
  );
