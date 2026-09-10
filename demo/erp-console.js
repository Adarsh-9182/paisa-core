/**
 * Paisa ERP console — the finance-team surface.
 *
 * Kept as its own module and its own route so the AI CFO dashboard in
 * server.js is untouched. Everything on this page is computed by the
 * deterministic engines; the page only formats what they return.
 */

import { formatINR, prevPeriod } from "../dist/src/index.js";
import { describeRun } from "../dist/src/erp/cfo-agent.js";

const CONTROLLER = "priya";

const lastDay = (period) => {
  const [y, m] = period.split("-").map(Number);
  return `${period}-${String(new Date(Date.UTC(y, m, 0)).getUTCDate()).padStart(2, "0")}`;
};

/* ------------------------------------------------------------------ */
/* API                                                                 */
/* ------------------------------------------------------------------ */

/** The seeded demo company closes June 2026. A real company closes its own last month. */
const DEMO_PERIOD = "2026-06";

export { CONTROLLER, DEMO_PERIOD as CLOSE_PERIOD };

/**
 * Reading the close is not running it.
 *
 * This route used to call `close.run`, which meant a GET mutated the books —
 * and, once the period was locked, `run` refuses, so fetching the page threw
 * and the ERP console stayed broken from the moment you closed the month. The
 * last run is read here; running a new one is what the button is for.
 */
/*
 * The period is whichever month these books are closing. It used to be fixed
 * at June 2026 for everyone, which is right only for the seeded demo company.
 */
export const erpApi = (org, erp, PERIOD = DEMO_PERIOD) => ({
  close() {
    const run = erp.close.status(PERIOD);
    const periods = erp.periods.all().map((p) => ({ period: p.period, status: p.status, closedBy: p.closedBy }));
    if (!run)
      return {
        period: PERIOD, periodStatus: erp.periods.status(PERIOD), hasRun: false,
        passed: 0, blocked: 0, readyToClose: false, locked: false, tasks: [], periods,
      };
    return {
      period: PERIOD,
      periodStatus: erp.periods.status(PERIOD),
      hasRun: true,
      passed: run.passed,
      blocked: run.blocked,
      readyToClose: run.readyToClose,
      locked: run.locked,
      tasks: run.tasks.map((t) => ({
        id: t.id, name: t.name, category: t.category, status: t.status,
        detail: t.detail, blockers: t.blockers, automated: t.automated,
        waivedBy: t.waivedBy, waiverReason: t.waiverReason,
      })),
      periods,
    };
  },

  revenue() {
    const rf = erp.revrec.rollforward(PERIOD, (d) => org.ledger.balance("acc_deferred_revenue", d));
    return {
      waterfall: erp.revrec.waterfall(PERIOD, 12).map((c) => ({ period: c.period, amount: formatINR(c.amount), raw: Number(c.amount) })),
      rpo: formatINR(erp.revrec.remainingPerformanceObligation()),
      rollforward: {
        opening: formatINR(rf.opening), billed: formatINR(rf.billed),
        recognized: formatINR(rf.recognized), closing: formatINR(rf.closing),
        ledgerClosing: formatINR(rf.ledgerClosing), ties: rf.tiesToLedger,
      },
      recognizedYtd: formatINR(org.ledger.balance("acc_subscription_revenue", lastDay(PERIOD))),
      deferred: formatINR(org.ledger.balance("acc_deferred_revenue", lastDay(PERIOD))),
      unbilled: formatINR(org.ledger.balance("acc_unbilled_ar", lastDay(PERIOD))),
    };
  },

  contracts() {
    return erp.contracts.all().map((c) => ({
      id: c.id, number: c.number, customer: c.customer, status: c.status, version: c.version,
      transactionPrice: formatINR(c.transactionPrice),
      recognized: formatINR(erp.revrec.recognizedToDate(c.id)),
      billed: formatINR(erp.revrec.billedToDate(c.id)),
      deferred: formatINR(erp.revrec.deferredBalanceOf(c.id)),
      unbilled: formatINR(erp.revrec.unbilledBalanceOf(c.id)),
      term: `${c.startDate} → ${c.endDate}`,
      obligations: c.obligations.map((o) => ({
        description: o.description, method: o.method,
        ssp: formatINR(o.ssp), allocated: formatINR(o.allocated),
      })),
    }));
  },

  metrics() {
    const m = erp.metrics.movement(PERIOD);
    const r = erp.metrics.retention(prevPeriod(prevPeriod(prevPeriod(PERIOD))), PERIOD);
    return {
      period: PERIOD,
      openingMrr: formatINR(m.openingMrr), newMrr: formatINR(m.newMrr),
      expansion: formatINR(m.expansionMrr), contraction: formatINR(m.contractionMrr),
      churn: formatINR(m.churnedMrr), closingMrr: formatINR(m.closingMrr),
      arr: formatINR(m.arr), customers: m.customerCount,
      backlog: formatINR(erp.metrics.backlog()),
      arpa: formatINR(erp.metrics.arpa(PERIOD)),
      nrr: r.nrrBps === null ? "n/a" : `${(r.nrrBps / 100).toFixed(1)}%`,
      grr: r.grrBps === null ? "n/a" : `${(r.grrBps / 100).toFixed(1)}%`,
      movements: m.movements.map((mv) => ({ customer: mv.customer, kind: mv.kind, delta: formatINR(mv.delta) })),
    };
  },

  agents() {
    return erp.agents.open().map((p) => ({
      id: p.id, kind: p.kind, severity: p.severity, period: p.period,
      title: p.title, rationale: p.rationale,
      amount: p.amount ? formatINR(p.amount) : null,
      postsOnApproval: p.proposedEntry !== null,
    }));
  },

  /*
   * A standing authority is a delegated power, so the panel that shows it
   * has to answer two questions a controller actually asks: what may run
   * without me, and has it been right. The second is `reversed` — postings
   * made under a grant that a human later undid — and it is the number that
   * says whether to widen the grant or narrow it.
   */
  authority() {
    const stats = erp.authority.stats();
    return {
      stats,
      grants: erp.authority.all().map((a) => ({
        id: a.id,
        kind: a.kind,
        maxAmount: formatINR(a.maxAmount),
        maxPerSweep: formatINR(a.maxPerSweep),
        accounts: a.accounts,
        note: a.note,
        grantedBy: a.grantedBy,
        grantedAt: a.grantedAt,
        expiresAt: a.expiresAt,
        revokedAt: a.revokedAt,
        revokedBy: a.revokedBy,
        active: !a.revokedAt && (!a.expiresAt || a.expiresAt >= new Date().toISOString()),
      })),
    };
  },

  /*
   * Budget against actuals. Only budgeted accounts appear, and favourable
   * lines are kept in the report even though the agent never raises them —
   * a variance report that hid the good news would be a list of complaints,
   * not a plan you can read.
   */
  budgets() {
    const report = erp.budgetReport(PERIOD);
    return {
      period: PERIOD,
      budgetedTotal: formatINR(report.budgetedTotal),
      actualTotal: formatINR(report.actualTotal),
      lines: report.lines.map((l) => ({
        accountId: l.accountId,
        name: l.name,
        type: l.type,
        budget: formatINR(l.budget),
        actual: formatINR(l.actual),
        variance: formatINR(l.variance),
        pct: l.varianceBps === null ? null : Math.round(l.varianceBps / 100),
        unfavourable: l.unfavourable,
        breach: l.breach,
      })),
    };
  },

  /*
   * The agent's own page: what its last sweep did, and what it left. Reading
   * it never runs a sweep — a GET that acts is how the close route used to
   * mutate the books just by being loaded.
   */
  cfo() {
    const run = erp.cfo.last();
    if (!run) return { hasRun: false, plays: [], digest: "The agent has not run yet." };
    return {
      hasRun: true,
      ranAt: run.ranAt,
      asOf: run.asOf,
      acted: run.acted,
      waiting: run.waiting,
      quiet: run.quiet,
      digest: describeRun(run),
      plays: run.plays.map((p) => ({
        play: p.play,
        title: p.title,
        headline: p.headline,
        unchanged: p.unchanged,
        did: p.did,
        forYou: p.forYou,
      })),
    };
  },

  subledgers() {
    const asOf = lastDay(PERIOD);
    const t = erp.tieOut(asOf);
    return {
      asOf,
      ar: { subledger: formatINR(t.ar.subledger), ledger: formatINR(t.ar.ledger), ties: t.ar.ties },
      ap: { subledger: formatINR(t.ap.subledger), ledger: formatINR(t.ap.ledger), ties: t.ap.ties },
      aging: erp.bills.aging(asOf).buckets.map((b) => ({ label: b.label, amount: formatINR(b.amount), count: b.count })),
      pendingApproval: erp.bills.pendingApproval().length,
      connectors: erp.connectors.all().map((c) => ({
        source: c.source, kind: c.kind, lastSyncAt: c.lastSyncAt,
        ingested: c.recordsIngested, duplicates: c.duplicatesSkipped,
      })),
    };
  },
});

/**
 * The read routes, by name. The router uses this to decide what a GET may
 * reach, so a future write method on `erpApi` cannot become reachable by GET
 * just by existing.
 */
export const ERP_READS = new Set(["close", "revenue", "contracts", "metrics", "agents", "authority", "subledgers", "budgets", "cfo"]);
