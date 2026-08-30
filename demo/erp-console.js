/**
 * Paisa ERP console — the finance-team surface.
 *
 * Kept as its own module and its own route so the AI CFO dashboard in
 * server.js is untouched. Everything on this page is computed by the
 * deterministic engines; the page only formats what they return.
 */

import { parseINR, formatINR, attachErp } from "../dist/src/index.js";

const ACTOR = "adarsh";
const CONTROLLER = "priya";

/* ------------------------------------------------------------------ */
/* Seed: a SaaS company mid-year, with a close waiting to happen       */
/* ------------------------------------------------------------------ */

export const seedErp = (org) => {
  const erp = attachErp(org, {
    firstPeriod: "2026-01",
    approvalPolicy: { limits: new Map([["junior", parseINR("50,000")]]), segregationOfDuties: true },
  });

  // Two contracts, arriving through the CRM connector as DRAFT.
  erp.connectors.register("salesforce", "CRM");
  erp.connectors.register("stripe", "BILLING");
  const sync = erp.connectors.syncCrmDeals(
    "salesforce",
    [
      {
        externalId: "0061",
        name: "Acme — Platform + onboarding",
        accountName: "Acme Pvt Ltd",
        closeDate: "2025-12-20",
        amount: parseINR("36,00,000"),
        startDate: "2026-01-01",
        endDate: "2026-12-31",
        billingFrequency: "QUARTERLY",
        lineItems: [
          { description: "Platform subscription", ssp: parseINR("36,00,000"), method: "RATABLE_MONTHLY" },
          { description: "Onboarding & implementation", ssp: parseINR("4,00,000"), method: "POINT_IN_TIME", endDate: null },
        ],
      },
      {
        externalId: "0074",
        name: "Globex — Growth plan",
        accountName: "Globex Ltd",
        closeDate: "2026-02-10",
        amount: parseINR("18,00,000"),
        startDate: "2026-03-01",
        endDate: "2027-02-28",
        billingFrequency: "MONTHLY",
      },
    ],
    ACTOR,
  );
  for (const id of sync.created) erp.contracts.activate(id, CONTROLLER);

  // Bill what is due, recognise the months that have passed.
  erp.revrec.billDue("2026-06-30", ACTOR, 18);
  for (const p of ["2026-01", "2026-02", "2026-03", "2026-04", "2026-05"]) {
    erp.revrec.recognize(p, ACTOR);
  }

  // Payables: a recurring vendor that skipped June, so the agent has work.
  for (const m of ["01", "02", "03", "04", "05"]) {
    const b = erp.bills.create(
      {
        number: `AWS-2026-${m}`,
        vendor: "AWS India",
        billDate: `2026-${m}-05`,
        dueDate: `2026-${m}-25`,
        lines: [{ description: "Cloud hosting", amount: parseINR("1,20,000"), expenseAccountId: "acc_software", gstRatePct: 18, itcEligible: true }],
      },
      ACTOR,
    );
    erp.bills.submit(b.id, ACTOR);
    erp.bills.approve(b.id, CONTROLLER);
    if (m !== "05") erp.bills.recordPayment(b.id, `2026-${m}-25`, parseINR("1,41,600"), ACTOR);
  }

  // Prepaid + fixed asset so the close has schedules to run.
  erp.schedules.addPrepaid(
    { description: "Annual D&O insurance", total: parseINR("2,40,000"), startPeriod: "2026-01", endPeriod: "2026-12", expenseAccountId: "acc_professional", fundingAccountId: "acc_bank" },
    ACTOR,
  );
  erp.schedules.addAsset(
    { name: "Engineering laptops", cost: parseINR("12,00,000"), salvageValue: parseINR("1,20,000"), inServicePeriod: "2026-01", usefulLifeMonths: 36, assetAccountId: "acc_equipment", fundingAccountId: "acc_bank" },
    ACTOR,
  );
  for (const p of ["2026-01", "2026-02", "2026-03", "2026-04", "2026-05"]) {
    erp.schedules.runAmortization(p, ACTOR);
    erp.schedules.runDepreciation(p, ACTOR);
  }

  // Close January through May so June is the live one.
  for (const p of ["2026-01", "2026-02", "2026-03", "2026-04", "2026-05"]) {
    const bal = org.ledger.balance("acc_bank", lastDay(p));
    const rec = erp.reconciliation.reconcile({
      accountId: "acc_bank", asOf: lastDay(p),
      statementClosingBalance: bal, bookBalance: bal,
      statementLines: [], bookEntries: [],
    });
    erp.reconciliation.complete(rec.id, CONTROLLER);
    for (const f of erp.close.flux(p)) {
      if (f.needsExplanation && !f.explanation)
        erp.close.explain(p, f.accountId, "Reviewed with the controller — expected movement", CONTROLLER);
    }
    erp.close.run(p, CONTROLLER);
    try { erp.close.lock(p, CONTROLLER); } catch { /* leave open if genuinely blocked */ }
  }

  // June: raise the exceptions but leave the close undone — that is the demo.
  erp.agents.scan("2026-06", ACTOR);
  erp.close.run("2026-06", CONTROLLER);
  return erp;
};

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
