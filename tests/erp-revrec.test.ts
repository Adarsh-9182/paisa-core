import { describe, it, expect } from "vitest";
import { Platform, parseINR, paise, sum, add, sub, ZERO } from "../src/index.js";
import { erpAccounts } from "../src/erp/accounts.js";
import { PeriodEngine, PeriodError, periodOf, periodEnd, periodRange } from "../src/erp/periods.js";
import { ContractEngine, allocateByRelativeSsp, ContractError } from "../src/erp/contracts.js";
import { RevRecEngine, obligationSchedule } from "../src/erp/revrec.js";

const setup = () => {
  const platform = new Platform();
  const org = platform.createOrganization("org_rev", "Nimbus Labs");
  erpAccounts(org.chart);
  const periods = new PeriodEngine(org.orgId, org.bus, "2026-01");
  org.journal.addGuard(periods.guard());
  const contracts = new ContractEngine(org.orgId, org.bus);
  const revrec = new RevRecEngine(org.orgId, contracts, org.journal, org.bus);
  return { org, periods, contracts, revrec };
};

/** A 12-month subscription + one-off setup fee, discounted overall. */
const annualContract = (contracts: ContractEngine) =>
  contracts.create(
    {
      number: "C-001",
      customer: "Acme Pvt Ltd",
      signedDate: "2026-01-01",
      // SSP totals ₹13,00,000 but the customer pays ₹12,00,000 — a discount
      // that step 4 must spread across both obligations.
      transactionPrice: parseINR("12,00,000"),
      obligations: [
        {
          description: "Platform subscription",
          ssp: parseINR("12,00,000"),
          startDate: "2026-01-01",
          endDate: "2026-12-31",
          method: "RATABLE_DAILY",
        },
        {
          description: "Implementation & setup",
          ssp: parseINR("1,00,000"),
          startDate: "2026-01-01",
          method: "POINT_IN_TIME",
        },
      ],
      billingFrequency: "QUARTERLY",
    },
    "adarsh",
  );

describe("ASC 606 step 4 — relative SSP allocation", () => {
  it("allocates the transaction price exactly, remainder to the largest SSP", () => {
    const tp = paise(100000n); // ₹1,000.00
    const allocs = allocateByRelativeSsp(tp, [paise(33333n), paise(33333n), paise(33334n)]);
    expect(sum(allocs)).toBe(tp);
  });

  it("never leaves a rounding gap on awkward thirds", () => {
    const tp = paise(1000n);
    const allocs = allocateByRelativeSsp(tp, [paise(1n), paise(1n), paise(1n)]);
    expect(sum(allocs)).toBe(tp);
  });

  it("spreads a contract discount across obligations", () => {
    const { contracts } = setup();
    const c = annualContract(contracts);
    const allocated = c.obligations.map((o) => o.allocated);
    expect(sum(allocated)).toBe(c.transactionPrice);
    // Discounted proportionally: subscription gets 12/13, setup 1/13.
    expect(allocated[0]!).toBe(parseINR("11,07,692.31"));
    expect(allocated[1]!).toBe(parseINR("92,307.69"));
  });

  it("rejects a ratable obligation with no end date", () => {
    const { contracts } = setup();
    expect(() =>
      contracts.create(
        {
          number: "C-BAD",
          customer: "X",
          signedDate: "2026-01-01",
          transactionPrice: parseINR("1,000"),
          obligations: [{ description: "sub", ssp: parseINR("1,000"), startDate: "2026-01-01", method: "RATABLE_DAILY" }],
          billingFrequency: "UPFRONT",
        },
        "adarsh",
      ),
    ).toThrow(ContractError);
  });
});

describe("ASC 606 step 5 — recognition schedule", () => {
  it("spreads a ratable obligation across every month and sums to the allocation", () => {
    const { contracts } = setup();
    const c = annualContract(contracts);
    const sub12 = c.obligations[0]!;
    const lines = obligationSchedule(c, sub12);
    expect(lines).toHaveLength(12);
    expect(sum(lines.map((l) => l.amount))).toBe(sub12.allocated);
  });

  it("recognises a point-in-time obligation entirely in its own month", () => {
    const { contracts } = setup();
    const c = annualContract(contracts);
    const setupFee = c.obligations[1]!;
    const lines = obligationSchedule(c, setupFee);
    expect(lines).toHaveLength(1);
    expect(lines[0]!.period).toBe("2026-01");
    expect(lines[0]!.amount).toBe(setupFee.allocated);
  });

  it("recognises usage only when it has been reported", () => {
    const { contracts, revrec } = setup();
    const c = contracts.create(
      {
        number: "C-USAGE",
        customer: "Metered Co",
        signedDate: "2026-01-01",
        transactionPrice: parseINR("1,00,000"),
        obligations: [
          { description: "API calls", ssp: parseINR("1,00,000"), startDate: "2026-01-01", method: "USAGE", revenueAccountId: "acc_usage_revenue" },
        ],
        billingFrequency: "ON_USAGE",
      },
      "adarsh",
    );
    contracts.activate(c.id, "adarsh");
    expect(revrec.schedule(c.id)).toHaveLength(0);
    revrec.reportUsage(c.id, c.obligations[0]!.id, "2026-03", parseINR("18,400"), "adarsh");
    const sched = revrec.schedule(c.id);
    expect(sched).toHaveLength(1);
    expect(sched[0]!.amount).toBe(parseINR("18,400"));
  });
});

describe("revenue recognition posts to the ledger", () => {
  it("recognises ahead of billing into the contract asset, then clears it", () => {
    const { org, contracts, revrec } = setup();
    const c = annualContract(contracts);
    contracts.activate(c.id, "adarsh");

    // January: recognise before anything is billed → unbilled receivable.
    const run = revrec.recognize("2026-01", "adarsh")!;
    expect(run).not.toBeNull();
    const unbilled = org.ledger.balance("acc_unbilled_ar", "2026-01-31");
    expect(unbilled).toBe(run.amount);
    expect(org.ledger.balance("acc_deferred_revenue", "2026-01-31")).toBe(ZERO);
    expect(revrec.unbilledBalanceOf(c.id)).toBe(run.amount);

    // Q1 billing lands: it first clears the contract asset, rest deferred.
    const billing = revrec.bill(c.id, c.billingSchedule[0]!.id, "adarsh");
    expect(org.ledger.balance("acc_unbilled_ar", "2026-01-31")).toBe(ZERO);
    expect(org.ledger.balance("acc_deferred_revenue", "2026-01-31")).toBe(
      sub(billing.net, run.amount),
    );
    expect(org.ledger.trialBalance("2026-12-31").balanced).toBe(true);
  });

  it("is idempotent — running the same period twice recognises once", () => {
    const { org, contracts, revrec } = setup();
    const c = annualContract(contracts);
    contracts.activate(c.id, "adarsh");
    const first = revrec.recognize("2026-02", "adarsh");
    expect(first).not.toBeNull();
    const again = revrec.recognize("2026-02", "adarsh");
    expect(again).toBeNull();
    const revenue = org.ledger.balance("acc_subscription_revenue", "2026-02-28");
    expect(revenue).toBe(first!.amount);
  });

  it("recognises the full transaction price over the contract's life and no more", () => {
    const { org, contracts, revrec } = setup();
    const c = annualContract(contracts);
    contracts.activate(c.id, "adarsh");
    for (const p of periodRange("2026-01", "2026-12")) revrec.recognize(p, "adarsh");
    const revenue = org.ledger.balance("acc_subscription_revenue", "2026-12-31");
    expect(revenue).toBe(c.transactionPrice);
    expect(revrec.remainingPerformanceObligation()).toBe(ZERO);
  });

  it("reports remaining performance obligation as a forward waterfall", () => {
    const { contracts, revrec } = setup();
    const c = annualContract(contracts);
    contracts.activate(c.id, "adarsh");
    revrec.recognize("2026-01", "adarsh");
    const wf = revrec.waterfall("2026-01", 12);
    expect(wf[0]!.amount).toBe(ZERO); // January already recognised
    expect(sum(wf.map((w) => w.amount))).toBe(revrec.remainingPerformanceObligation());
  });

  it("ties the deferred revenue roll-forward back to the general ledger", () => {
    const { org, contracts, revrec } = setup();
    const c = annualContract(contracts);
    contracts.activate(c.id, "adarsh");
    revrec.bill(c.id, c.billingSchedule[0]!.id, "adarsh");
    revrec.recognize("2026-01", "adarsh");
    const rf = revrec.rollforward("2026-01", (d) => org.ledger.balance("acc_deferred_revenue", d));
    expect(rf.tiesToLedger).toBe(true);
    expect(rf.closing).toBe(sub(rf.billed, rf.recognized));
  });
});

describe("period close lock", () => {
  it("blocks posting into a closed period", () => {
    const { org, periods } = setup();
    periods.close("2026-01", "adarsh");
    expect(() =>
      org.journal.post({
        date: "2026-01-15",
        narration: "late entry",
        lines: [
          { accountId: "acc_bank", side: "DEBIT", amount: parseINR("100") },
          { accountId: "acc_sales", side: "CREDIT", amount: parseINR("100") },
        ],
        sourceModule: "manual",
        createdBy: "adarsh",
      }),
    ).toThrow(PeriodError);
  });

  it("allows close adjustments while soft-closed but freezes subledgers", () => {
    const { org, periods } = setup();
    periods.softClose("2026-01", "adarsh");
    // revrec is a close module — allowed.
    expect(() =>
      org.journal.post({
        date: "2026-01-31",
        narration: "accrual",
        lines: [
          { accountId: "acc_rent", side: "DEBIT", amount: parseINR("100") },
          { accountId: "acc_accrued_liabilities", side: "CREDIT", amount: parseINR("100") },
        ],
        sourceModule: "accrual",
        createdBy: "adarsh",
      }),
    ).not.toThrow();
    // an invoice is not — subledgers are frozen.
    expect(() =>
      org.journal.post({
        date: "2026-01-31",
        narration: "late invoice",
        lines: [
          { accountId: "acc_ar", side: "DEBIT", amount: parseINR("100") },
          { accountId: "acc_sales", side: "CREDIT", amount: parseINR("100") },
        ],
        sourceModule: "invoice",
        createdBy: "adarsh",
      }),
    ).toThrow(PeriodError);
  });

  it("refuses to close out of order and logs every reopen", () => {
    const { periods } = setup();
    expect(() => periods.close("2026-03", "adarsh")).toThrow(PeriodError);
    periods.close("2026-01", "adarsh");
    periods.close("2026-02", "adarsh");
    expect(() => periods.reopen("2026-02", "adarsh", "")).toThrow(PeriodError);
    const reopened = periods.reopen("2026-02", "adarsh", "auditor found a missing accrual");
    expect(reopened.status).toBe("OPEN");
    expect(reopened.history.map((h) => h.to)).toEqual(["CLOSED", "OPEN"]);
  });
});
