import { describe, it, expect } from "vitest";
import { Platform, parseINR, paise, sum, add, sub, ZERO, formatINR } from "../src/index.js";
import { attachErp } from "../src/erp/suite.js";
import { BillError } from "../src/erp/bills.js";
import { CloseError } from "../src/erp/close.js";
import { ReconciliationError } from "../src/erp/reconciliation.js";
import { straightLine } from "../src/erp/schedules.js";
import { ConsolidationEngine } from "../src/erp/consolidation.js";
import { FxError } from "../src/erp/fx.js";

const setup = () => {
  const platform = new Platform();
  const org = platform.createOrganization("org_erp", "Nimbus Labs");
  const erp = attachErp(org, {
    firstPeriod: "2026-01",
    approvalPolicy: { limits: new Map([["junior", parseINR("50,000")]]), segregationOfDuties: true },
  });
  // Seed capital so cash exists.
  org.journal.post({
    date: "2026-01-01",
    narration: "Founder capital",
    lines: [
      { accountId: "acc_bank", side: "DEBIT", amount: parseINR("50,00,000") },
      { accountId: "acc_capital", side: "CREDIT", amount: parseINR("50,00,000") },
    ],
    sourceModule: "manual",
    createdBy: "adarsh",
  });
  return { org, erp };
};

describe("accounts payable", () => {
  const bill = (erp: ReturnType<typeof setup>["erp"], number: string, amount: string) =>
    erp.bills.create(
      {
        number,
        vendor: "AWS India",
        billDate: "2026-02-05",
        dueDate: "2026-03-05",
        lines: [
          { description: "Cloud hosting", amount: parseINR(amount), expenseAccountId: "acc_software", gstRatePct: 18, itcEligible: true },
        ],
      },
      "adarsh",
    );

  it("posts expense, input tax credit and the payable on approval", () => {
    const { org, erp } = setup();
    const b = bill(erp, "AWS-001", "1,00,000");
    erp.bills.submit(b.id, "adarsh");
    const approved = erp.bills.approve(b.id, "priya");
    expect(approved.status).toBe("APPROVED");
    expect(org.ledger.balance("acc_software", "2026-02-28")).toBe(parseINR("1,00,000"));
    expect(org.ledger.balance("acc_gst_itc", "2026-02-28")).toBe(parseINR("18,000"));
    expect(org.ledger.balance("acc_ap", "2026-02-28")).toBe(parseINR("1,18,000"));
  });

  it("capitalises blocked GST into the expense when ITC cannot be claimed", () => {
    const { org, erp } = setup();
    const b = erp.bills.create(
      {
        number: "FOOD-1",
        vendor: "Cafe Co",
        billDate: "2026-02-10",
        dueDate: "2026-02-20",
        lines: [
          { description: "Team lunch", amount: parseINR("10,000"), expenseAccountId: "acc_travel", gstRatePct: 5, itcEligible: false },
        ],
      },
      "adarsh",
    );
    erp.bills.submit(b.id, "adarsh");
    erp.bills.approve(b.id, "priya");
    // Blocked ITC is part of the cost, not an asset.
    expect(org.ledger.balance("acc_travel", "2026-02-28")).toBe(parseINR("10,500"));
    expect(org.ledger.balance("acc_gst_itc", "2026-02-28")).toBe(ZERO);
  });

  it("enforces segregation of duties and approval limits", () => {
    const { erp } = setup();
    const b = bill(erp, "AWS-002", "1,00,000");
    erp.bills.submit(b.id, "adarsh");
    expect(() => erp.bills.approve(b.id, "adarsh")).toThrow(BillError);
    expect(() => erp.bills.approve(b.id, "junior")).toThrow(BillError);
    expect(erp.bills.approve(b.id, "priya").status).toBe("APPROVED");
  });

  it("rejects a duplicate vendor invoice number", () => {
    const { erp } = setup();
    bill(erp, "AWS-003", "1,00,000");
    expect(() => bill(erp, "AWS-003", "1,00,000")).toThrow(/Duplicate bill/);
  });

  it("ages payables and clears them on payment", () => {
    const { erp } = setup();
    const b = bill(erp, "AWS-004", "1,00,000");
    erp.bills.submit(b.id, "adarsh");
    erp.bills.approve(b.id, "priya");
    expect(erp.bills.aging("2026-04-01").totalOutstanding).toBe(parseINR("1,18,000"));
    const paid = erp.bills.recordPayment(b.id, "2026-03-01", parseINR("1,18,000"), "adarsh");
    expect(paid.status).toBe("PAID");
    expect(erp.bills.aging("2026-04-01").totalOutstanding).toBe(ZERO);
  });
});

describe("schedules — accruals, prepaids, depreciation", () => {
  it("splits straight-line exactly with the remainder on the last period", () => {
    const cells = straightLine(paise(100n), "2026-01", "2026-03");
    expect(sum(cells.map((c) => c.amount))).toBe(paise(100n));
    expect(cells.map((c) => c.amount)).toEqual([paise(33n), paise(33n), paise(34n)]);
  });

  it("auto-reverses an accrual into the next period", () => {
    const { org, erp } = setup();
    erp.schedules.accrue(
      { description: "Electricity", period: "2026-01", amount: parseINR("20,000"), expenseAccountId: "acc_utilities" },
      "adarsh",
    );
    expect(org.ledger.balance("acc_utilities", "2026-01-31")).toBe(parseINR("20,000"));
    expect(org.ledger.balance("acc_accrued_liabilities", "2026-01-31")).toBe(parseINR("20,000"));
    // Reversed on 1 Feb, so the expense nets to zero once February starts.
    expect(org.ledger.balance("acc_utilities", "2026-02-01")).toBe(ZERO);
    expect(org.ledger.balance("acc_accrued_liabilities", "2026-02-01")).toBe(ZERO);
  });

  it("amortises a prepaid over its term and never twice for a period", () => {
    const { org, erp } = setup();
    erp.schedules.addPrepaid(
      {
        description: "Annual insurance",
        total: parseINR("1,20,000"),
        startPeriod: "2026-01",
        endPeriod: "2026-12",
        expenseAccountId: "acc_professional",
        fundingAccountId: "acc_bank",
      },
      "adarsh",
    );
    expect(org.ledger.balance("acc_prepaid", "2026-01-01")).toBe(parseINR("1,20,000"));
    const first = erp.schedules.runAmortization("2026-01", "adarsh");
    expect(first.amount).toBe(parseINR("10,000"));
    const again = erp.schedules.runAmortization("2026-01", "adarsh");
    expect(again.amount).toBe(ZERO);
    expect(org.ledger.balance("acc_professional", "2026-01-31")).toBe(parseINR("10,000"));
  });

  it("depreciates an asset straight-line to its salvage value", () => {
    const { org, erp } = setup();
    const asset = erp.schedules.addAsset(
      {
        name: "MacBook fleet",
        cost: parseINR("6,00,000"),
        salvageValue: parseINR("60,000"),
        inServicePeriod: "2026-01",
        usefulLifeMonths: 36,
        assetAccountId: "acc_equipment",
        fundingAccountId: "acc_bank",
      },
      "adarsh",
    );
    expect(sum(asset.schedule.map((s) => s.amount))).toBe(parseINR("5,40,000"));
    erp.schedules.runDepreciation("2026-01", "adarsh");
    expect(org.ledger.balance("acc_depreciation_expense", "2026-01-31")).toBe(parseINR("15,000"));
    expect(erp.schedules.netBookValue(asset.id)).toBe(parseINR("5,85,000"));
  });
});

describe("bank reconciliation", () => {
  it("matches on exact date, then a date window, then a shared reference", () => {
    const { erp } = setup();
    const rec = erp.reconciliation.reconcile({
      accountId: "acc_bank",
      asOf: "2026-01-31",
      statementClosingBalance: parseINR("1,000"),
      bookBalance: parseINR("1,000"),
      statementLines: [
        { reference: "TXN1", date: "2026-01-10", description: "Stripe payout", amount: parseINR("500") },
        { reference: "TXN2", date: "2026-01-20", description: "AWS charge", amount: parseINR("-200") },
        { reference: "TXN3", date: "2026-01-25", description: "Zomato refund ref XYZ", amount: parseINR("700") },
      ],
      bookEntries: [
        { entryId: "je1", date: "2026-01-10", narration: "Stripe payout", amount: parseINR("500") },
        { entryId: "je2", date: "2026-01-18", narration: "AWS hosting", amount: parseINR("-200") },
        { entryId: "je3", date: "2026-01-02", narration: "Zomato refund", amount: parseINR("700") },
      ],
    });
    expect(rec.matches.map((m) => m.basis)).toEqual(["EXACT_DATE", "DATE_WINDOW", "REFERENCE"]);
    expect(rec.reconciled).toBe(true);
  });

  it("refuses to complete while an unexplained difference remains", () => {
    const { erp } = setup();
    const rec = erp.reconciliation.reconcile({
      accountId: "acc_bank",
      asOf: "2026-01-31",
      statementClosingBalance: parseINR("1,000"),
      bookBalance: parseINR("1,500"),
      statementLines: [],
      bookEntries: [],
    });
    expect(rec.reconciled).toBe(false);
    expect(() => erp.reconciliation.complete(rec.id, "adarsh")).toThrow(ReconciliationError);
  });

  it("treats an uncleared payment as an outstanding item, not a difference", () => {
    const { erp } = setup();
    const rec = erp.reconciliation.reconcile({
      accountId: "acc_bank",
      asOf: "2026-01-31",
      statementClosingBalance: parseINR("1,000"),
      bookBalance: parseINR("700"),
      statementLines: [],
      bookEntries: [{ entryId: "je9", date: "2026-01-30", narration: "Cheque to vendor", amount: parseINR("-300") }],
    });
    expect(rec.outstandingPayments).toBe(parseINR("300"));
    expect(rec.reconciled).toBe(true);
    expect(erp.reconciliation.complete(rec.id, "adarsh").status).toBe("COMPLETED");
  });
});

describe("multi-currency", () => {
  it("refuses to convert without a loaded rate rather than guessing", () => {
    const { erp } = setup();
    expect(() => erp.fx.convert(parseINR("100"), "USD", "2026-01-31")).toThrow(FxError);
  });

  it("converts at the exact rational rate for the date", () => {
    const { erp } = setup();
    erp.fx.setRate("USD", "2026-01-31", 8350n, 100n); // ₹83.50/USD
    // $1,000.00 = 100000 cents → ₹83,500.00
    expect(erp.fx.convert(paise(100000n), "USD", "2026-01-31")).toBe(parseINR("83,500"));
  });
});

describe("multi-entity consolidation", () => {
  it("eliminates matched intercompany balances and reports the plug as CTA", () => {
    const group = new ConsolidationEngine("grp_nimbus", "INR");
    group.addEntity({ orgId: "org_in", name: "Nimbus India", functionalCurrency: "INR", ownershipBps: 10000, parentOrgId: null });
    group.addEntity({ orgId: "org_us", name: "Nimbus US", functionalCurrency: "USD", ownershipBps: 10000, parentOrgId: "org_in" });

    const consolidated = group.consolidate(
      "2026-01",
      [
        {
          orgId: "org_in",
          rows: [
            { code: "1010", name: "Bank", type: "ASSET", balance: parseINR("10,00,000") },
            { code: "1600", name: "Intercompany Receivable", type: "ASSET", balance: parseINR("2,00,000") },
            { code: "3000", name: "Owner's Capital", type: "EQUITY", balance: parseINR("12,00,000") },
          ],
        },
        {
          orgId: "org_us",
          rows: [
            { code: "1010", name: "Bank", type: "ASSET", balance: paise(200000n) },
            { code: "2600", name: "Intercompany Payable", type: "LIABILITY", balance: paise(240000n) },
            { code: "3000", name: "Owner's Capital", type: "EQUITY", balance: paise(-40000n) },
          ],
        },
      ],
      new Map([["org_us", { closing: { num: 8350n, den: 100n }, average: { num: 8300n, den: 100n } }]]),
    );

    const ic = consolidated.rows.find((r) => r.code === "1600")!;
    expect(ic.consolidated).toBe(ZERO); // fully eliminated against 2600
    expect(consolidated.balanced).toBe(true);
    expect(consolidated.entities).toEqual(["org_in", "org_us"]);
  });

  it("surfaces an unmatched intercompany balance instead of netting it away", () => {
    const group = new ConsolidationEngine("grp2", "INR");
    group.addEntity({ orgId: "a", name: "A", functionalCurrency: "INR", ownershipBps: 10000, parentOrgId: null });
    group.addEntity({ orgId: "b", name: "B", functionalCurrency: "INR", ownershipBps: 10000, parentOrgId: "a" });
    const c = group.consolidate(
      "2026-01",
      [
        { orgId: "a", rows: [{ code: "1600", name: "IC Receivable", type: "ASSET", balance: parseINR("5,000") }] },
        { orgId: "b", rows: [{ code: "2600", name: "IC Payable", type: "LIABILITY", balance: parseINR("4,000") }] },
      ],
      new Map(),
    );
    expect(c.intercompanyMismatches).toHaveLength(1);
    expect(c.intercompanyMismatches[0]!.difference).toBe(parseINR("1,000"));
  });
});
