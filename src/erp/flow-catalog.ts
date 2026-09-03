/**
 * The standard flows a finance team switches on.
 *
 * These are definitions, not handlers: the cadence, the catch-up policy and
 * the task name, with the work itself registered separately. Keeping them as
 * data means the catalogue can be reviewed by a controller — who cares very
 * much whether amortisation catches up and a digest does not — without
 * reading the code that runs it.
 *
 * The `catchUp` column is the one to review. Every flow here is marked
 * against a single question: if this had not run for four months, would the
 * books be wrong, or would there just be four reports nobody wants?
 *
 *   - Wrong books → "each". The postings are owed per period and skipping
 *     any leaves a gap that reconciles to nothing.
 *   - Stale reports → "latest". Sending four back-dated digests is noise, and
 *     noise is how a controller learns to ignore the tool.
 *
 * Nothing here posts on its own. A flow raises proposals; approval posts them,
 * and the approval is attributed — the same rule the agent layer runs on.
 */

import type { FlowDefinition } from "./flows.js";

/** Task names handlers register against. */
export const FLOW_TASKS = {
  arReminders: "ar.reminders",
  cashForecast: "cash.forecast13",
  preCloseScan: "close.riskScan",
  boardSummary: "report.board",
  deferredRevenue: "revrec.rollForward",
  prepaidAmortisation: "schedules.prepaid",
  controlMonitor: "controls.monitor",
  cfoDigest: "report.cfoDigest",
  vendorBillAlert: "ap.vendorAlert",
  badDebt: "ar.badDebt",
} as const;

const SUNDAY = 0;
const MONDAY = 1;

/**
 * The catalogue, disabled by default.
 *
 * A flow that starts running the moment it is deployed is a flow nobody chose.
 * Switching one on is a decision with a named owner, so `enabled` is false
 * here and set deliberately per workspace.
 */
export const STANDARD_FLOWS: readonly FlowDefinition[] = [
  /* ---- postings: every period is owed one ---- */

  {
    id: "flow_prepaid_amortisation",
    name: "Prepaid amortisation",
    cadence: { kind: "monthly", day: 1 },
    // Each month's amortisation is its own entry. Skipping August because
    // September also came due would leave August's expense unrecorded.
    catchUp: "each",
    task: FLOW_TASKS.prepaidAmortisation,
    startDate: "2026-01-01",
    enabled: false,
  },
  {
    id: "flow_deferred_revenue",
    name: "Deferred revenue roll-forward",
    cadence: { kind: "monthly", day: 1 },
    // Same reasoning: recognition is per period under ASC 606, and a missed
    // month overstates deferred revenue until someone notices by hand.
    catchUp: "each",
    task: FLOW_TASKS.deferredRevenue,
    startDate: "2026-01-01",
    enabled: false,
  },

  /* ---- scans and reports: only the current one is worth anything ---- */

  {
    id: "flow_pre_close_scan",
    name: "Pre-close risk scan",
    cadence: { kind: "monthly", day: 1 },
    catchUp: "latest",
    task: FLOW_TASKS.preCloseScan,
    startDate: "2026-01-01",
    enabled: false,
  },
  {
    id: "flow_control_monitor",
    name: "Continuous control monitor",
    cadence: { kind: "daily" },
    catchUp: "latest",
    task: FLOW_TASKS.controlMonitor,
    startDate: "2026-01-01",
    enabled: false,
    // Large or unusual movements worth a human look. The threshold is a
    // parameter rather than a constant because it is a policy question, and
    // the number that is right for a seed-stage company is wrong for a
    // hundred-crore one.
    params: { thresholdPaise: 10_00_000_00 },
  },
  {
    id: "flow_vendor_bill_alert",
    name: "New vendor and large bill alerts",
    cadence: { kind: "daily" },
    catchUp: "latest",
    task: FLOW_TASKS.vendorBillAlert,
    startDate: "2026-01-01",
    enabled: false,
    params: { thresholdPaise: 25_00_000_00 },
  },
  {
    id: "flow_ar_reminders",
    name: "AR reminders",
    cadence: { kind: "weekly", weekday: MONDAY },
    catchUp: "latest",
    task: FLOW_TASKS.arReminders,
    startDate: "2026-01-01",
    enabled: false,
    params: { minOverdueDays: 30, minUnpaidInvoices: 2 },
  },
  {
    id: "flow_cash_forecast",
    name: "13-week cash forecast",
    cadence: { kind: "weekly", weekday: MONDAY },
    catchUp: "latest",
    task: FLOW_TASKS.cashForecast,
    startDate: "2026-01-01",
    enabled: false,
    params: { weeks: 13 },
  },
  {
    id: "flow_cfo_digest",
    name: "Weekly CFO digest",
    cadence: { kind: "weekly", weekday: SUNDAY },
    catchUp: "latest",
    task: FLOW_TASKS.cfoDigest,
    startDate: "2026-01-01",
    enabled: false,
  },
  {
    id: "flow_board_summary",
    name: "Board financial summary",
    cadence: { kind: "quarterly", day: 1 },
    catchUp: "latest",
    task: FLOW_TASKS.boardSummary,
    startDate: "2026-01-01",
    enabled: false,
  },
  {
    id: "flow_bad_debt",
    name: "Bad debt analysis",
    cadence: { kind: "quarterly", day: 1 },
    catchUp: "latest",
    task: FLOW_TASKS.badDebt,
    startDate: "2026-01-01",
    enabled: false,
    params: { overdueDays: 90 },
  },
];

/**
 * Flows whose handler posts to the ledger.
 *
 * Named explicitly rather than inferred from `catchUp`, so that the day
 * someone adds a posting flow with the wrong policy, the test that compares
 * these two lists fails instead of the books.
 */
export const POSTING_FLOWS: ReadonlySet<string> = new Set([
  "flow_prepaid_amortisation",
  "flow_deferred_revenue",
]);

export const flowById = (id: string): FlowDefinition | undefined =>
  STANDARD_FLOWS.find((f) => f.id === id);
