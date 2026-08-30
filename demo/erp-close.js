/**
 * Paisa ERP — a full quarter, end to end.
 *
 * Runs the whole Rillet-class cycle against the deterministic engines:
 * contracts → billing → ASC 606 recognition → subledgers → continuous
 * agents → month-end close → period lock, then prints what the books say.
 *
 * Run:  npm run build && node demo/erp-close.js
 */

import { Platform, parseINR, formatINR, attachErp } from "../dist/src/index.js";

const ACTOR = "adarsh";
const CONTROLLER = "priya";

const platform = new Platform();
const org = platform.createOrganization("org_nimbus", "Nimbus Labs Pvt Ltd");
const erp = attachErp(org, {
  firstPeriod: "2026-01",
  approvalPolicy: { limits: new Map([["junior", parseINR("50,000")]]), segregationOfDuties: true },
});

const h = (t) => console.log(`\n\x1b[1m${t}\x1b[0m\n${"─".repeat(t.length)}`);
const row = (k, v) => console.log(`  ${k.padEnd(38)} ${v}`);

/* ---------------------------------------------------------------- */
h("1 · Capital and a signed contract");

org.journal.post({
  date: "2026-01-01",
  narration: "Founder capital",
  lines: [
    { accountId: "acc_bank", side: "DEBIT", amount: parseINR("60,00,000") },
    { accountId: "acc_capital", side: "CREDIT", amount: parseINR("60,00,000") },
  ],
  sourceModule: "manual",
  createdBy: ACTOR,
});

// A CRM deal arrives and becomes a DRAFT contract — never auto-posted.
erp.connectors.register("salesforce", "CRM");
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
  ],
  ACTOR,
);
const contract = erp.contracts.get(sync.created[0]);
row("Deal synced from Salesforce", `${contract.number} — ${contract.customer}`);
row("Status on arrival", `${contract.status} (a human activates it)`);
row("Transaction price", formatINR(contract.transactionPrice));
console.log("\n  ASC 606 step 4 — relative SSP allocation:");
for (const o of contract.obligations) {
  row(`    ${o.description}`, `${formatINR(o.allocated)}  [${o.method}]`);
}
erp.contracts.activate(contract.id, CONTROLLER);

/* ---------------------------------------------------------------- */
h("2 · Q1 billing and monthly recognition");

const q1 = contract.billingSchedule[0];
const billing = erp.revrec.bill(contract.id, q1.id, ACTOR, 18);
row("Q1 invoice raised", `${formatINR(billing.total)} (incl. GST ${formatINR(billing.gst)})`);
row("Deferred revenue after billing", formatINR(org.ledger.balance("acc_deferred_revenue", "2026-01-01")));

for (const period of ["2026-01", "2026-02", "2026-03"]) {
  const run = erp.revrec.recognize(period, ACTOR);
  row(`Recognised ${period}`, formatINR(run.amount));
}
row("Deferred revenue at 31 Mar", formatINR(org.ledger.balance("acc_deferred_revenue", "2026-03-31")));
row("Revenue recognised YTD", formatINR(org.ledger.balance("acc_subscription_revenue", "2026-03-31")));

/* ---------------------------------------------------------------- */
h("3 · Subledgers — payables, prepaids, assets");

for (const m of ["01", "02", "03"]) {
  const b = erp.bills.create(
    {
      number: `AWS-2026-${m}`,
      vendor: "AWS India",
      billDate: `2026-${m}-05`,
      dueDate: `2026-${m}-25`,
      lines: [
        { description: "Cloud hosting", amount: parseINR("1,20,000"), expenseAccountId: "acc_software", gstRatePct: 18, itcEligible: true },
      ],
    },
    ACTOR,
  );
  erp.bills.submit(b.id, ACTOR);
  erp.bills.approve(b.id, CONTROLLER);
  erp.bills.recordPayment(b.id, `2026-${m}-25`, parseINR("1,41,600"), ACTOR);
}
row("Vendor bills approved & paid", "3 × AWS India");

erp.schedules.addPrepaid(
  {
    description: "Annual D&O insurance",
    total: parseINR("2,40,000"),
    startPeriod: "2026-01",
    endPeriod: "2026-12",
    expenseAccountId: "acc_professional",
    fundingAccountId: "acc_bank",
  },
  ACTOR,
);
const laptop = erp.schedules.addAsset(
  {
    name: "Engineering laptops",
    cost: parseINR("12,00,000"),
    salvageValue: parseINR("1,20,000"),
    inServicePeriod: "2026-01",
    usefulLifeMonths: 36,
    assetAccountId: "acc_equipment",
    fundingAccountId: "acc_bank",
  },
  ACTOR,
);
row("Prepaid insurance", `${formatINR(parseINR("2,40,000"))} over 12 months`);
row("Assets capitalised", `${formatINR(laptop.cost)} over ${laptop.usefulLifeMonths} months`);

/* ---------------------------------------------------------------- */
h("4 · Continuous agents — exceptions before month-end");

// April: AWS did not bill. The accrual agent should notice.
const proposals = erp.agents.scan("2026-04", ACTOR);
if (proposals.length === 0) console.log("  No exceptions raised.");
for (const p of proposals) {
  console.log(`  [${p.severity}] ${p.title}`);
  console.log(`         ${p.rationale.replace(/\s+/g, " ").slice(0, 150)}…`);
  console.log(`         posts on approval: ${p.proposedEntry !== null}`);
}

/* ---------------------------------------------------------------- */
h("5 · Month-end close — March");

// Reconcile the bank so the close has a chance of passing.
const bookBalance = org.ledger.balance("acc_bank", "2026-03-31");
const bankEntries = org.journal
  .all()
  .filter((e) => e.date <= "2026-03-31")
  .flatMap((e) =>
    e.lines
      .filter((l) => l.accountId === "acc_bank")
      .map((l) => ({
        entryId: e.id,
        date: e.date,
        narration: e.narration,
        amount: l.side === "DEBIT" ? l.amount : -l.amount,
      })),
  );
const rec = erp.reconciliation.reconcile({
  accountId: "acc_bank",
  asOf: "2026-03-31",
  statementClosingBalance: bookBalance,
  bookBalance,
  statementLines: bankEntries.map((e, i) => ({
    reference: `TXN${i + 1}`,
    date: e.date,
    description: e.narration,
    amount: e.amount,
  })),
  bookEntries: bankEntries,
});
erp.reconciliation.complete(rec.id, CONTROLLER);
row("Bank reconciliation", `${rec.matches.length} matched, difference ${formatINR(rec.difference)}`);

let run = erp.close.run("2026-03", CONTROLLER);
console.log("");
for (const t of run.tasks) {
  const mark = t.status === "PASSED" ? "\x1b[32m✓\x1b[0m" : t.status === "WAIVED" ? "\x1b[33m~\x1b[0m" : "\x1b[31m✗\x1b[0m";
  console.log(`  ${mark} ${t.name.padEnd(46)} ${t.detail}`);
  for (const b of t.blockers) console.log(`      \x1b[31m↳ ${b}\x1b[0m`);
}

// Explain any material movement the flux agent flagged.
for (const f of erp.close.flux("2026-03")) {
  if (f.needsExplanation && !f.explanation) {
    erp.close.explain("2026-03", f.accountId, "Reviewed with the controller — expected seasonal movement", CONTROLLER);
  }
}
run = erp.close.run("2026-03", CONTROLLER);
console.log("");
row("Tasks passed", `${run.passed}/${run.tasks.length}`);
row("Ready to close", String(run.readyToClose));

if (run.readyToClose) {
  erp.periods.close("2026-01", CONTROLLER);
  erp.periods.close("2026-02", CONTROLLER);
  const locked = erp.close.lock("2026-03", CONTROLLER);
  row("March locked at", locked.completedAt);
  try {
    org.journal.post({
      date: "2026-03-15",
      narration: "Late expense",
      lines: [
        { accountId: "acc_travel", side: "DEBIT", amount: parseINR("5,000") },
        { accountId: "acc_bank", side: "CREDIT", amount: parseINR("5,000") },
      ],
      sourceModule: "manual",
      createdBy: ACTOR,
    });
    row("Posting into a closed period", "\x1b[31mALLOWED — this is a bug\x1b[0m");
  } catch (e) {
    row("Posting into a closed period", `\x1b[32mrefused\x1b[0m — ${e.message.slice(0, 60)}`);
  }
}

/* ---------------------------------------------------------------- */
h("6 · What the books say");

const tb = org.ledger.trialBalance("2026-03-31");
const bs = org.statements.balanceSheet("2026-03-31");
const pl = org.statements.profitAndLoss("2026-01-01", "2026-03-31");
const m = erp.metrics.movement("2026-03");
const rf = erp.revrec.rollforward("2026-03", (d) => org.ledger.balance("acc_deferred_revenue", d));

row("Trial balance", tb.balanced ? "\x1b[32mbalanced\x1b[0m" : "\x1b[31mOUT\x1b[0m");
row("Balance sheet equation", bs.equationHolds ? "\x1b[32mholds\x1b[0m" : "\x1b[31mBROKEN\x1b[0m");
row("Q1 revenue", formatINR(pl.totalRevenue));
row("Q1 net profit", formatINR(pl.netProfit));
row("MRR / ARR", `${formatINR(m.closingMrr)} / ${formatINR(m.arr)}`);
row("Backlog (RPO)", formatINR(erp.metrics.backlog()));
row("Deferred revenue roll-forward", rf.tiesToLedger ? "\x1b[32mties to the ledger\x1b[0m" : "\x1b[31mDOES NOT TIE\x1b[0m");
row("Audit events recorded", String(org.bus.audit(org.orgId).length));

console.log("\n  Revenue waterfall (remaining performance obligation):");
for (const c of erp.revrec.waterfall("2026-04", 9)) {
  if (c.amount > 0n) console.log(`    ${c.period}   ${formatINR(c.amount)}`);
}
console.log("");
