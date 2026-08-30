/**
 * Paisa persistence — proof that state survives the process.
 *
 * Each run appends one month of real business activity to an on-disk
 * Postgres (PGlite), then rebuilds the entire ledger by replaying the log.
 * Nothing is ever written out as state; what you see was arrived at the
 * same way it was arrived at the first time.
 *
 * Run it three times. The books grow; the process does not remember.
 *
 *   npm run build && node demo/persistence.js
 *
 * Reset with:  rm -rf .paisa-data/pg
 */

import { mkdirSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { PaisaRuntime, PostgresActionStore, parseINR, formatINR } from "../dist/src/index.js";

const DATA_DIR = ".paisa-data/pg";
const ACTOR = "adarsh";
const CONTROLLER = "priya";

mkdirSync(DATA_DIR, { recursive: true });
const pglite = new PGlite(DATA_DIR);
await pglite.waitReady;
const db = {
  async query(text, params) {
    const res = await pglite.query(text, params ? [...params] : undefined);
    return { rows: res.rows };
  },
};

const store = new PostgresActionStore(db);
const rt = await PaisaRuntime.open({
  orgId: "org_nimbus",
  name: "Nimbus Labs Pvt Ltd",
  firstPeriod: "2026-01",
  store,
});

const h = (t) => console.log(`\n\x1b[1m${t}\x1b[0m\n${"─".repeat(t.length)}`);
const row = (k, v) => console.log(`  ${k.padEnd(36)} ${v}`);

const priorSeq = rt.appliedThrough();
const runNumber = rt.org.journal.all().length === 0 ? 1 : monthsRecorded() + 1;

function monthsRecorded() {
  return new Set(rt.org.journal.all().map((e) => e.date.slice(0, 7))).size;
}

h(`Cold start — replayed ${priorSeq} action${priorSeq === 1 ? "" : "s"} from disk`);
row("Database", `${DATA_DIR} (PGlite — real Postgres)`);
row("Journal entries rebuilt", String(rt.org.journal.all().length));
row("Trial balance", rt.org.ledger.trialBalance("2027-12-31").balanced ? "\x1b[32mbalanced\x1b[0m" : "\x1b[31mOUT\x1b[0m");
if (priorSeq === 0) console.log("\n  (first run — the log is empty, so there is nothing to replay yet)");

/* ---------------------------------------------------------------- */

const MONTHS = ["2026-01", "2026-02", "2026-03", "2026-04", "2026-05", "2026-06"];
const period = MONTHS[Math.min(runNumber - 1, MONTHS.length - 1)];

h(`Run ${runNumber} — recording ${period}`);

if (priorSeq === 0) {
  await rt.execute("journal.post", {
    date: "2026-01-01",
    narration: "Founder capital",
    lines: [
      { accountId: "acc_bank", side: "DEBIT", amount: parseINR("60,00,000") },
      { accountId: "acc_capital", side: "CREDIT", amount: parseINR("60,00,000") },
    ],
    sourceModule: "manual",
  }, ACTOR);

  const contract = await rt.execute("contract.create", {
    input: {
      number: "C-2026-001",
      customer: "Acme Pvt Ltd",
      signedDate: "2026-01-01",
      transactionPrice: parseINR("24,00,000"),
      obligations: [{
        description: "Platform subscription",
        ssp: parseINR("24,00,000"),
        startDate: "2026-01-01",
        endDate: "2026-12-31",
        method: "RATABLE_MONTHLY",
      }],
      billingFrequency: "QUARTERLY",
    },
  }, ACTOR);
  await rt.execute("contract.activate", { contractId: contract.result.id }, CONTROLLER);
  row("Seeded", "capital + a 12-month contract");
}

// Bill anything due, recognise the month, run the schedules.
const lastDay = (p) => {
  const [y, m] = p.split("-").map(Number);
  return `${p}-${String(new Date(Date.UTC(y, m, 0)).getUTCDate()).padStart(2, "0")}`;
};

const billed = await rt.execute("revrec.billDue", { asOf: lastDay(period), gstRatePct: 18 }, ACTOR);
if (billed.result.length) row("Billed", `${billed.result.length} instalment(s)`);

const recognised = await rt.execute("revrec.recognize", { period }, ACTOR);
row("Revenue recognised", recognised.result ? formatINR(recognised.result.amount) : "already recognised");

const bill = await rt.execute("bill.create", {
  input: {
    number: `AWS-${period}`,
    vendor: "AWS India",
    billDate: `${period}-05`,
    dueDate: `${period}-25`,
    lines: [{ description: "Cloud hosting", amount: parseINR("1,20,000"), expenseAccountId: "acc_software", gstRatePct: 18, itcEligible: true }],
  },
}, ACTOR);
await rt.execute("bill.submit", { billId: bill.result.id }, ACTOR);
await rt.execute("bill.approve", { billId: bill.result.id }, CONTROLLER);
row("Vendor bill", `AWS India ${formatINR(bill.result.total)} approved`);

/* ---------------------------------------------------------------- */

h("The books, rebuilt from the log");
const asOf = lastDay(period);
row("Actions in the log", String(rt.appliedThrough()));
row("Journal entries", String(rt.org.journal.all().length));
row("Bank", formatINR(rt.org.ledger.balance("acc_bank", asOf)));
row("Revenue recognised to date", formatINR(rt.org.ledger.balance("acc_subscription_revenue", asOf)));
row("Deferred revenue", formatINR(rt.org.ledger.balance("acc_deferred_revenue", asOf)));
row("Accounts payable", formatINR(rt.org.ledger.balance("acc_ap", asOf)));
row("Backlog (RPO)", formatINR(rt.erp.metrics.backlog()));
row("Trial balance", rt.org.ledger.trialBalance(asOf).balanced ? "\x1b[32mbalanced\x1b[0m" : "\x1b[31mOUT\x1b[0m");

const skipped = rt.skippedActions();
if (skipped.length) {
  console.log("\n  Actions in the log that could not be applied (kept as attempts):");
  for (const s of skipped) console.log(`    seq ${s.seq} ${s.type} — ${s.reason.slice(0, 70)}`);
}

console.log(`\n  \x1b[2mRun again to record ${MONTHS[Math.min(runNumber, MONTHS.length - 1)]}. Reset with: rm -rf ${DATA_DIR}\x1b[0m\n`);
await pglite.close();
