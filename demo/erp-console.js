/**
 * Paisa ERP console — the finance-team surface.
 *
 * Kept as its own module and its own route so the AI CFO dashboard in
 * server.js is untouched. Everything on this page is computed by the
 * deterministic engines; the page only formats what they return.
 */

import { formatINR } from "../dist/src/index.js";

const CONTROLLER = "priya";

const lastDay = (period) => {
  const [y, m] = period.split("-").map(Number);
  return `${period}-${String(new Date(Date.UTC(y, m, 0)).getUTCDate()).padStart(2, "0")}`;
};

/* ------------------------------------------------------------------ */
/* API                                                                 */
/* ------------------------------------------------------------------ */

const PERIOD = "2026-06";

export const erpApi = (org, erp) => ({
  close() {
    const run = erp.close.run(PERIOD, CONTROLLER);
    return {
      period: PERIOD,
      periodStatus: erp.periods.status(PERIOD),
      passed: run.passed,
      blocked: run.blocked,
      readyToClose: run.readyToClose,
      locked: run.locked,
      tasks: run.tasks.map((t) => ({
        id: t.id, name: t.name, category: t.category, status: t.status,
        detail: t.detail, blockers: t.blockers, automated: t.automated,
        waivedBy: t.waivedBy, waiverReason: t.waiverReason,
      })),
      periods: erp.periods.all().map((p) => ({ period: p.period, status: p.status, closedBy: p.closedBy })),
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
    const r = erp.metrics.retention("2026-03", PERIOD);
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

export const erpActions = (erp) => ({
  approveProposal: (id) => erp.agents.approve(id, CONTROLLER),
  dismissProposal: (id, reason) => erp.agents.dismiss(id, CONTROLLER, reason || "not applicable"),
  runClose: () => erp.close.run(PERIOD, CONTROLLER),
  lockPeriod: () => erp.close.lock(PERIOD, CONTROLLER),
});
