import { describe, it, expect } from "vitest";
import { Platform, parseINR, paise, sum, sub, ZERO, formatINR } from "../src/index.js";
import { attachErp } from "../src/erp/suite.js";
import { CloseError } from "../src/erp/close.js";
import { PeriodError } from "../src/erp/periods.js";

const ACTOR = "adarsh";

/** A company with one annual SaaS contract, a vendor bill, and a bank account. */
const company = () => {
  const platform = new Platform();
  const org = platform.createOrganization("org_cycle", "Nimbus Labs");
  const erp = attachErp(org, { firstPeriod: "2026-01" });

  org.journal.post({
    date: "2026-01-01",
    narration: "Founder capital",
    lines: [
      { accountId: "acc_bank", side: "DEBIT", amount: parseINR("50,00,000") },
      { accountId: "acc_capital", side: "CREDIT", amount: parseINR("50,00,000") },
    ],
    sourceModule: "manual",
    createdBy: ACTOR,
  });

  const contract = erp.contracts.create(
    {
      number: "C-2026-001",
      customer: "Acme Pvt Ltd",
      signedDate: "2026-01-01",
      transactionPrice: parseINR("24,00,000"),
      obligations: [
        {
          description: "Platform subscription (12 months)",
          ssp: parseINR("24,00,000"),
          startDate: "2026-01-01",
          endDate: "2026-12-31",
          method: "RATABLE_MONTHLY",
        },
      ],
      billingFrequency: "ANNUAL",
    },
    ACTOR,
  );
  erp.contracts.activate(contract.id, ACTOR);
  return { org, erp, contract };
};

describe("end-to-end month-end close", () => {
  it("bills upfront, recognises monthly, and draws down deferred revenue", () => {
    const { org, erp, contract } = company();

    // Annual invoice raised on day one: all ₹24L sits in deferred revenue.
    erp.revrec.bill(contract.id, contract.billingSchedule[0]!.id, ACTOR, 18);
    expect(org.ledger.balance("acc_deferred_revenue", "2026-01-01")).toBe(parseINR("24,00,000"));
    expect(org.ledger.balance("acc_ar", "2026-01-01")).toBe(parseINR("28,32,000")); // incl 18% GST

    // January recognition takes one twelfth out of deferred revenue.
    const run = erp.revrec.recognize("2026-01", ACTOR)!;
    expect(run.amount).toBe(parseINR("2,00,000"));
    expect(org.ledger.balance("acc_deferred_revenue", "2026-01-31")).toBe(parseINR("22,00,000"));
    expect(org.ledger.balance("acc_subscription_revenue", "2026-01-31")).toBe(parseINR("2,00,000"));

    // The roll-forward ties to the ledger — no plug.
    const rf = erp.revrec.rollforward("2026-01", (d) => org.ledger.balance("acc_deferred_revenue", d));
    expect(rf.tiesToLedger).toBe(true);
  });

  it("blocks the close until every check passes, then locks the period", () => {
    const { org, erp, contract } = company();
    erp.revrec.bill(contract.id, contract.billingSchedule[0]!.id, ACTOR, 18);

    // First run: the bank is not reconciled, so the close is blocked.
    const first = erp.close.run("2026-01", ACTOR);
    expect(first.readyToClose).toBe(false);
    const bankTask = first.tasks.find((t) => t.id === "bank_reconciliations")!;
    expect(bankTask.status).toBe("BLOCKED");
    expect(() => erp.close.lock("2026-01", ACTOR)).toThrow(CloseError);

    // Reconcile the bank against a statement that agrees with the books.
    const bookBalance = org.ledger.balance("acc_bank", "2026-01-31");
    const rec = erp.reconciliation.reconcile({
      accountId: "acc_bank",
      asOf: "2026-01-31",
      statementClosingBalance: bookBalance,
      bookBalance,
      statementLines: [
        { reference: "SEED", date: "2026-01-01", description: "Founder capital", amount: parseINR("50,00,000") },
      ],
      bookEntries: [
        { entryId: "je_seed", date: "2026-01-01", narration: "Founder capital", amount: parseINR("50,00,000") },
      ],
    });
    erp.reconciliation.complete(rec.id, ACTOR);

    // Second run: everything passes and the period locks.
    const second = erp.close.run("2026-01", ACTOR);
    expect(second.blocked).toBe(0);
    expect(second.readyToClose).toBe(true);
    const locked = erp.close.lock("2026-01", ACTOR);
    expect(locked.locked).toBe(true);
    expect(erp.periods.status("2026-01")).toBe("CLOSED");
  });

  it("makes a closed period genuinely unpostable", () => {
    const { org, erp, contract } = company();
    erp.revrec.bill(contract.id, contract.billingSchedule[0]!.id, ACTOR, 18);
    const bookBalance = org.ledger.balance("acc_bank", "2026-01-31");
    const rec = erp.reconciliation.reconcile({
      accountId: "acc_bank", asOf: "2026-01-31",
      statementClosingBalance: bookBalance, bookBalance,
      statementLines: [], bookEntries: [],
    });
    erp.reconciliation.complete(rec.id, ACTOR);
    erp.close.run("2026-01", ACTOR);
    erp.close.lock("2026-01", ACTOR);

    expect(() =>
      org.journal.post({
        date: "2026-01-15",
        narration: "Forgotten expense",
        lines: [
          { accountId: "acc_travel", side: "DEBIT", amount: parseINR("5,000") },
          { accountId: "acc_bank", side: "CREDIT", amount: parseINR("5,000") },
        ],
        sourceModule: "manual",
        createdBy: ACTOR,
      }),
    ).toThrow(PeriodError);
  });

  it("recognises the whole contract across the year with nothing left over", () => {
    const { org, erp, contract } = company();
    erp.revrec.bill(contract.id, contract.billingSchedule[0]!.id, ACTOR);
    for (let m = 1; m <= 12; m++) {
      erp.revrec.recognize(`2026-${String(m).padStart(2, "0")}`, ACTOR);
    }
    expect(org.ledger.balance("acc_subscription_revenue", "2026-12-31")).toBe(parseINR("24,00,000"));
    expect(org.ledger.balance("acc_deferred_revenue", "2026-12-31")).toBe(ZERO);
    expect(erp.revrec.remainingPerformanceObligation()).toBe(ZERO);
    expect(org.ledger.trialBalance("2026-12-31").balanced).toBe(true);
  });
});

describe("SaaS metrics from the same contracts", () => {
  it("computes MRR, ARR and the movement bridge", () => {
    const { erp } = company();
    expect(erp.metrics.mrr("2026-03")).toBe(parseINR("2,00,000"));
    expect(erp.metrics.arr("2026-03")).toBe(parseINR("24,00,000"));

    // A second customer starts in April — that is NEW MRR.
    const c2 = erp.contracts.create(
      {
        number: "C-2026-002",
        customer: "Globex Ltd",
        signedDate: "2026-03-15",
        transactionPrice: parseINR("6,00,000"),
        obligations: [
          { description: "Subscription", ssp: parseINR("6,00,000"), startDate: "2026-04-01", endDate: "2026-09-30", method: "RATABLE_MONTHLY" },
        ],
        billingFrequency: "MONTHLY",
      },
      ACTOR,
    );
    erp.contracts.activate(c2.id, ACTOR);

    const april = erp.metrics.movement("2026-04");
    expect(april.newMrr).toBe(parseINR("1,00,000"));
    expect(april.closingMrr).toBe(parseINR("3,00,000"));
    expect(april.customerCount).toBe(2);

    // Globex ends in September, so October shows churn.
    const october = erp.metrics.movement("2026-10");
    expect(october.churnedMrr).toBe(parseINR("1,00,000"));
    expect(october.movements.find((m) => m.customer === "Globex Ltd")!.kind).toBe("CHURN");
  });

  it("reports backlog as the unrecognised remainder", () => {
    const { erp } = company();
    erp.revrec.recognize("2026-01", ACTOR);
    expect(erp.metrics.backlog()).toBe(parseINR("22,00,000"));
  });
});

describe("continuous agents", () => {
  it("proposes an accrual for a recurring vendor that did not bill", () => {
    const { erp } = company();
    for (const month of ["01", "02", "03"]) {
      const b = erp.bills.create(
        {
          number: `AWS-${month}`,
          vendor: "AWS India",
          billDate: `2026-${month}-05`,
          dueDate: `2026-${month}-25`,
          lines: [{ description: "Hosting", amount: parseINR("80,000"), expenseAccountId: "acc_software", gstRatePct: 18, itcEligible: true }],
        },
        ACTOR,
      );
      erp.bills.submit(b.id, ACTOR);
      erp.bills.approve(b.id, "priya");
    }
    // April: no AWS bill arrived.
    const raised = erp.agents.scan("2026-04", ACTOR);
    const accrual = raised.find((p) => p.kind === "MISSING_ACCRUAL");
    expect(accrual).toBeDefined();
    expect(accrual!.amount).toBe(parseINR("80,000"));
    expect(accrual!.proposedEntry).not.toBeNull();
  });

  it("only posts when a human approves, and attributes the entry to them", () => {
    const { org, erp } = company();
    for (const month of ["01", "02", "03"]) {
      const b = erp.bills.create(
        {
          number: `AWS-${month}`, vendor: "AWS India",
          billDate: `2026-${month}-05`, dueDate: `2026-${month}-25`,
          lines: [{ description: "Hosting", amount: parseINR("80,000"), expenseAccountId: "acc_software", gstRatePct: 18, itcEligible: true }],
        },
        ACTOR,
      );
      erp.bills.submit(b.id, ACTOR);
      erp.bills.approve(b.id, "priya");
    }
    const proposal = erp.agents.scan("2026-04", ACTOR).find((p) => p.kind === "MISSING_ACCRUAL")!;

    // Nothing posted while it is merely proposed.
    expect(org.ledger.balance("acc_accrued_liabilities", "2026-04-30")).toBe(ZERO);

    const approved = erp.agents.approve(proposal.id, "priya");
    expect(approved.status).toBe("APPROVED");
    expect(approved.resultingEntryId).not.toBeNull();
    expect(org.journal.get(approved.resultingEntryId!).createdBy).toBe("priya");
    expect(org.ledger.balance("acc_accrued_liabilities", "2026-04-30")).toBe(parseINR("80,000"));
  });

  describe("flux analysis", () => {
    // Two months of the same expense, so a change is a change against a base.
    const spend = (org: ReturnType<typeof company>["org"], date: string, amount: string, narration = "Cloud") =>
      org.journal.post({
        date,
        narration,
        lines: [
          { accountId: "acc_software", side: "DEBIT", amount: parseINR(amount) },
          { accountId: "acc_bank", side: "CREDIT", amount: parseINR(amount) },
        ],
        sourceModule: "manual",
        createdBy: ACTOR,
      });

    it("flags a material swing and names what caused it", () => {
      const { org, erp } = company();
      spend(org, "2026-05-04", "1,00,000");
      spend(org, "2026-06-04", "1,00,000");
      spend(org, "2026-06-20", "2,00,000", "Annual licence true-up");

      const flux = erp.agents.scan("2026-06", ACTOR).filter((p) => p.kind === "FLUX_VARIANCE");
      const software = flux.find((p) => p.title.startsWith("Software"))!;
      expect(software).toBeDefined();
      // ₹1,00,000 → ₹3,00,000 is +200%, well past both thresholds
      expect(software.amount).toBe(parseINR("2,00,000"));
      expect(software.title).toContain("200%");
      // the point of flux: it explains rather than merely flagging
      expect(software.rationale).toContain("Annual licence true-up");
      expect(software.evidence.length).toBeGreaterThan(0);
      // a variance is a question about booked work, never an entry to post
      expect(software.proposedEntry).toBeNull();
    });

    it("ignores a big percentage on an immaterial amount", () => {
      const { org, erp } = company();
      spend(org, "2026-05-04", "1,000");
      spend(org, "2026-06-04", "9,000"); // +800%, but only ₹8,000 of movement

      const flux = erp.agents.scan("2026-06", ACTOR).filter((p) => p.kind === "FLUX_VARIANCE");
      expect(flux.find((p) => p.title.startsWith("Software"))).toBeUndefined();
    });

    it("ignores a large amount that barely moved", () => {
      const { org, erp } = company();
      spend(org, "2026-05-04", "10,00,000");
      spend(org, "2026-06-04", "10,30,000"); // ₹30,000 clears the floor, 3% does not

      const flux = erp.agents.scan("2026-06", ACTOR).filter((p) => p.kind === "FLUX_VARIANCE");
      expect(flux.find((p) => p.title.startsWith("Software"))).toBeUndefined();
    });

    it("treats an account with no prior period as new rather than infinite", () => {
      const { org, erp } = company();
      spend(org, "2026-06-04", "5,00,000");

      const software = erp.agents
        .scan("2026-06", ACTOR)
        .find((p) => p.kind === "FLUX_VARIANCE" && p.title.startsWith("Software"))!;
      expect(software.title).toContain("against nothing");
      expect(software.severity).toBe("HIGH");
      expect(software.title).not.toContain("Infinity");
      expect(software.title).not.toContain("NaN");
    });

    it("counts a reversal, because the period's P&L does", () => {
      const { org, erp } = company();
      spend(org, "2026-05-04", "4,00,000");
      const wrong = spend(org, "2026-06-04", "4,00,000");
      // reversed in the same period: June's software spend is really nil
      org.journal.reverse(wrong.id, ACTOR, "Booked twice", "2026-06-05");

      const flux = erp.agents
        .scan("2026-06", ACTOR)
        .find((p) => p.kind === "FLUX_VARIANCE" && p.title.startsWith("Software"))!;
      // ₹4,00,000 → nil is a 100% fall, not "no change"
      expect(flux).toBeDefined();
      expect(flux.amount).toBe(parseINR("4,00,000"));
    });
  });

  it("flags unrecognised revenue before the close", () => {
    const { erp } = company();
    const raised = erp.agents.scan("2026-02", ACTOR);
    const missing = raised.find((p) => p.kind === "MISSING_RECOGNITION");
    expect(missing).toBeDefined();
    expect(missing!.amount).toBe(parseINR("2,00,000"));
  });

  it("requires a reason to dismiss", () => {
    const { erp } = company();
    const p = erp.agents.scan("2026-02", ACTOR)[0]!;
    expect(() => erp.agents.dismiss(p.id, ACTOR, "")).toThrow();
    expect(erp.agents.dismiss(p.id, ACTOR, "already handled manually").status).toBe("DISMISSED");
  });
});

describe("integrations", () => {
  it("turns a closed-won deal into a DRAFT contract, never a posted one", () => {
    const { org, erp } = company();
    erp.connectors.register("salesforce", "CRM");
    const outcome = erp.connectors.syncCrmDeals(
      "salesforce",
      [
        {
          externalId: "0061",
          name: "Initech — Platform",
          accountName: "Initech",
          closeDate: "2026-02-01",
          amount: parseINR("12,00,000"),
          startDate: "2026-03-01",
          endDate: "2027-02-28",
          billingFrequency: "QUARTERLY",
        },
      ],
      ACTOR,
    );
    expect(outcome.created).toHaveLength(1);
    const contract = erp.contracts.get(outcome.created[0]!);
    expect(contract.status).toBe("DRAFT");
    // Nothing hit the ledger from the sync.
    expect(org.ledger.balance("acc_deferred_revenue", "2026-03-31")).toBe(ZERO);
  });

  it("is idempotent — replaying a sync creates nothing new", () => {
    const { erp } = company();
    erp.connectors.register("stripe", "BILLING");
    const records = [
      { externalId: "ch_1", customer: "Acme", date: "2026-01-10", amount: parseINR("50,000"), description: "Subscription", status: "paid" as const },
    ];
    expect(erp.connectors.syncBilling("stripe", records, ACTOR).created).toHaveLength(1);
    const replay = erp.connectors.syncBilling("stripe", records, ACTOR);
    expect(replay.created).toHaveLength(0);
    expect(replay.duplicates).toEqual(["ch_1"]);
  });
});

describe("flux analysis", () => {
  it("demands an explanation for a material swing, and accepts one", () => {
    const { org, erp, contract } = company();
    erp.revrec.bill(contract.id, contract.billingSchedule[0]!.id, ACTOR);
    erp.revrec.recognize("2026-01", ACTOR);

    // February: a large one-off marketing spend against a quiet January.
    org.journal.post({
      date: "2026-01-31",
      narration: "Baseline marketing",
      lines: [
        { accountId: "acc_marketing", side: "DEBIT", amount: parseINR("20,000") },
        { accountId: "acc_bank", side: "CREDIT", amount: parseINR("20,000") },
      ],
      sourceModule: "manual",
      createdBy: ACTOR,
    });
    org.journal.post({
      date: "2026-02-15",
      narration: "Product launch campaign",
      lines: [
        { accountId: "acc_marketing", side: "DEBIT", amount: parseINR("6,00,000") },
        { accountId: "acc_bank", side: "CREDIT", amount: parseINR("6,00,000") },
      ],
      sourceModule: "manual",
      createdBy: ACTOR,
    });

    const flux = erp.close.flux("2026-02");
    const marketing = flux.find((f) => f.accountId === "acc_marketing")!;
    expect(marketing.delta).toBe(parseINR("5,80,000"));
    expect(marketing.needsExplanation).toBe(true);
    expect(marketing.explanation).toBeNull();

    // The close is blocked while it is unexplained.
    const blocked = erp.close.run("2026-02", ACTOR);
    expect(blocked.tasks.find((t) => t.id === "flux_analysis")!.status).toBe("BLOCKED");

    erp.close.explain("2026-02", "acc_marketing", "Series A launch campaign, one-off, board approved", ACTOR);
    const after = erp.close.run("2026-02", ACTOR);
    expect(after.tasks.find((t) => t.id === "flux_analysis")!.status).toBe("PASSED");
  });

  it("records a waiver with its reason rather than silently passing a task", () => {
    const { erp } = company();
    const run = erp.close.run("2026-01", ACTOR);
    expect(run.tasks.find((t) => t.id === "bank_reconciliations")!.status).toBe("BLOCKED");
    const waived = erp.close.waive("2026-01", "bank_reconciliations", "priya", "statement arrives 3rd working day");
    const task = waived.tasks.find((t) => t.id === "bank_reconciliations")!;
    expect(task.status).toBe("WAIVED");
    expect(task.waivedBy).toBe("priya");
    expect(task.waiverReason).toBe("statement arrives 3rd working day");
    expect(waived.readyToClose).toBe(true);
  });
});

describe("deferred revenue roll-forward", () => {
  // Regression: recognition ahead of billing creates a contract asset, not a
  // draw on deferred revenue. The roll-forward must move only the deferred
  // legs or it reports a difference that does not exist.
  it("ties when revenue is recognised before anything is billed", () => {
    const { org, erp } = company();
    erp.revrec.recognize("2026-01", ACTOR);
    const rf = erp.revrec.rollforward("2026-01", (d) => org.ledger.balance("acc_deferred_revenue", d));
    expect(rf.recognized).toBe(ZERO); // nothing came out of deferred revenue
    expect(rf.closing).toBe(ZERO);
    expect(rf.tiesToLedger).toBe(true);
    expect(org.ledger.balance("acc_unbilled_ar", "2026-01-31")).toBe(parseINR("2,00,000"));
  });

  it("ties when billing and recognition happen in the same period", () => {
    const { org, erp, contract } = company();
    erp.revrec.bill(contract.id, contract.billingSchedule[0]!.id, ACTOR);
    erp.revrec.recognize("2026-01", ACTOR);
    const rf = erp.revrec.rollforward("2026-01", (d) => org.ledger.balance("acc_deferred_revenue", d));
    expect(rf.billed).toBe(parseINR("24,00,000"));
    expect(rf.recognized).toBe(parseINR("2,00,000"));
    expect(rf.closing).toBe(parseINR("22,00,000"));
    expect(rf.tiesToLedger).toBe(true);
  });
});

describe("subledger tie-out is as-at, not as-of-today", () => {
  // Regression: aging() reports on currently open documents, so an invoice
  // raised after the period end leaked into that period's subledger total
  // while its journal entry (correctly) did not. Tying a past period needs
  // the balance as it stood then.
  it("excludes a document raised after the period end", () => {
    const { org, erp } = company();

    const june = org.invoices.create(
      {
        number: "INV-JUN",
        customer: "Late Co",
        issueDate: "2026-06-10",
        dueDate: "2026-07-10",
        lines: [{ description: "Services", amount: parseINR("1,00,000"), gstRatePct: 18 }],
      },
      ACTOR,
    );
    org.invoices.send(june.id, ACTOR);

    // As at 31 May the June invoice does not exist in either place.
    const mayRun = erp.close.run("2026-05", ACTOR);
    expect(mayRun.tasks.find((t) => t.id === "ar_tie_out")!.status).toBe("PASSED");

    // As at 30 June it exists in both.
    const juneRun = erp.close.run("2026-06", ACTOR);
    expect(juneRun.tasks.find((t) => t.id === "ar_tie_out")!.status).toBe("PASSED");
    expect(org.ledger.balance("acc_ar", "2026-06-30")).toBe(parseINR("1,18,000"));
  });

  it("still counts an invoice that was settled after the period end", () => {
    const { org, erp } = company();
    const inv = org.invoices.create(
      {
        number: "INV-APR",
        customer: "Slow Payer",
        issueDate: "2026-04-05",
        dueDate: "2026-05-05",
        lines: [{ description: "Services", amount: parseINR("2,00,000"), gstRatePct: 18 }],
      },
      ACTOR,
    );
    org.invoices.send(inv.id, ACTOR);
    // Paid in June — so at 30 April it was still outstanding.
    org.invoices.recordPayment(inv.id, "2026-06-20", parseINR("2,36,000"), ACTOR);

    const aprilRun = erp.close.run("2026-04", ACTOR);
    expect(aprilRun.tasks.find((t) => t.id === "ar_tie_out")!.status).toBe("PASSED");
    expect(org.ledger.balance("acc_ar", "2026-04-30")).toBe(parseINR("2,36,000"));
    expect(org.ledger.balance("acc_ar", "2026-06-30")).toBe(ZERO);
  });

  it("ties accounts payable the same way", () => {
    const { org, erp } = company();
    const b = erp.bills.create(
      {
        number: "V-1",
        vendor: "Vendor Co",
        billDate: "2026-03-10",
        dueDate: "2026-04-10",
        lines: [{ description: "Consulting", amount: parseINR("50,000"), expenseAccountId: "acc_professional", gstRatePct: 18, itcEligible: true }],
      },
      ACTOR,
    );
    erp.bills.submit(b.id, ACTOR);
    erp.bills.approve(b.id, "priya");
    erp.bills.recordPayment(b.id, "2026-05-15", parseINR("59,000"), ACTOR);

    // Outstanding at 31 March, settled by 31 May.
    expect(erp.close.run("2026-03", ACTOR).tasks.find((t) => t.id === "ap_tie_out")!.status).toBe("PASSED");
    expect(org.ledger.balance("acc_ap", "2026-03-31")).toBe(parseINR("59,000"));
    expect(erp.close.run("2026-05", ACTOR).tasks.find((t) => t.id === "ap_tie_out")!.status).toBe("PASSED");
    expect(org.ledger.balance("acc_ap", "2026-05-31")).toBe(ZERO);
  });
});
