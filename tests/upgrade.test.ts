import { describe, it, expect } from "vitest";
import {
  Platform,
  parseINR,
  Orchestrator,
  CfoPlanner,
  AiUser,
  Permission,
} from "../src/index.js";

const freshOrg = (id = "org_t") => new Platform().createOrganization(id, "Test Co");

describe("invoice engine", () => {
  it("computes GST per line and posts a balanced entry on send", () => {
    const org = freshOrg();
    const inv = org.invoices.create(
      {
        number: "INV-001",
        customer: "Acme Corp",
        issueDate: "2026-06-01",
        dueDate: "2026-06-30",
        lines: [{ description: "Consulting", amount: parseINR("1,00,000"), gstRatePct: 18 }],
      },
      "adarsh",
    );
    expect(inv.subtotal).toBe(parseINR("1,00,000"));
    expect(inv.gstAmount).toBe(parseINR("18,000"));
    expect(inv.total).toBe(parseINR("1,18,000"));
    expect(inv.status).toBe("DRAFT");

    org.invoices.send(inv.id, "adarsh");
    expect(org.ledger.balance("acc_ar", "2026-06-01")).toBe(parseINR("1,18,000"));
    expect(org.ledger.balance("acc_gst_payable", "2026-06-01")).toBe(parseINR("18,000"));
    expect(org.ledger.balance("acc_services", "2026-06-01")).toBe(parseINR("1,00,000"));
    expect(org.ledger.trialBalance("2026-06-01").balanced).toBe(true);
  });

  it("tracks partial payments through to PAID and rejects overpayment", () => {
    const org = freshOrg();
    const inv = org.invoices.create(
      {
        number: "INV-002",
        customer: "Acme",
        issueDate: "2026-06-01",
        dueDate: "2026-06-30",
        lines: [{ description: "Work", amount: parseINR("1,00,000"), gstRatePct: 18 }],
      },
      "adarsh",
    );
    org.invoices.send(inv.id, "adarsh");
    const partial = org.invoices.recordPayment(inv.id, "2026-06-10", parseINR("50,000"), "adarsh");
    expect(partial.status).toBe("PARTIALLY_PAID");
    expect(org.invoices.outstanding(partial)).toBe(parseINR("68,000"));

    expect(() =>
      org.invoices.recordPayment(inv.id, "2026-06-11", parseINR("1,00,000"), "adarsh"),
    ).toThrow(/exceeds outstanding/);

    const paid = org.invoices.recordPayment(inv.id, "2026-06-20", parseINR("68,000"), "adarsh");
    expect(paid.status).toBe("PAID");
    expect(org.ledger.balance("acc_ar", "2026-06-20")).toBe(0n);
  });

  it("reports overdue invoices and aging buckets", () => {
    const org = freshOrg();
    const inv = org.invoices.create(
      {
        number: "INV-003",
        customer: "SlowPay Ltd",
        issueDate: "2026-05-01",
        dueDate: "2026-05-31",
        lines: [{ description: "Retainer", amount: parseINR("2,00,000"), gstRatePct: 18 }],
      },
      "adarsh",
    );
    org.invoices.send(inv.id, "adarsh");

    const overdue = org.invoices.overdue("2026-07-02");
    expect(overdue.length).toBe(1);
    expect(overdue[0]!.daysOverdue).toBe(32);
    expect(overdue[0]!.outstanding).toBe(parseINR("2,36,000"));

    const aging = org.invoices.aging("2026-07-02");
    expect(aging.totalOutstanding).toBe(parseINR("2,36,000"));
    const bucket = aging.buckets.find((b) => b.label === "31-60 days")!;
    expect(bucket.count).toBe(1);
  });

  it("only DRAFT invoices can be cancelled or sent", () => {
    const org = freshOrg();
    const inv = org.invoices.create(
      {
        number: "INV-004",
        customer: "X",
        issueDate: "2026-06-01",
        dueDate: "2026-06-30",
        lines: [{ description: "Work", amount: parseINR("10,000"), gstRatePct: 0 }],
      },
      "adarsh",
    );
    org.invoices.send(inv.id, "adarsh");
    expect(() => org.invoices.cancel(inv.id, "adarsh", "changed mind")).toThrow(/Only DRAFT/);
    expect(() => org.invoices.send(inv.id, "adarsh")).toThrow(/Only DRAFT/);
  });
});

describe("gst engine", () => {
  it("computes output tax, ITC, and net payable for a period", () => {
    const org = freshOrg();
    const inv = org.invoices.create(
      {
        number: "INV-010",
        customer: "Acme",
        issueDate: "2026-06-05",
        dueDate: "2026-07-05",
        lines: [{ description: "Services", amount: parseINR("1,00,000"), gstRatePct: 18 }],
      },
      "adarsh",
    );
    org.invoices.send(inv.id, "adarsh");
    // ITC accrues via the ledger (posted by purchase ingestion)
    org.journal.post({
      date: "2026-06-10",
      narration: "GST input credit on laptop purchase",
      lines: [
        { accountId: "acc_gst_itc", side: "DEBIT", amount: parseINR("5,000") },
        { accountId: "acc_bank", side: "CREDIT", amount: parseINR("5,000") },
      ],
      sourceModule: "banking",
      createdBy: "adarsh",
    });

    const pos = org.gst.position("2026-06-01", "2026-06-30");
    expect(pos.outputTax).toBe(parseINR("18,000"));
    expect(pos.inputTaxCredit).toBe(parseINR("5,000"));
    expect(pos.netPayable).toBe(parseINR("13,000"));
    expect(pos.unusedCredit).toBe(0n);
  });

  it("produces the GSTR filing calendar with correct due dates", () => {
    const org = freshOrg();
    const filings = org.gst.upcomingFilings("2026-07-02");
    const gstr1June = filings.find((f) => f.form === "GSTR-1" && f.period === "2026-06")!;
    expect(gstr1June.dueDate).toBe("2026-07-11");
    expect(gstr1June.daysLeft).toBe(9);
    const gstr3bJune = filings.find((f) => f.form === "GSTR-3B" && f.period === "2026-06")!;
    expect(gstr3bJune.dueDate).toBe("2026-07-20");
    // recently-overdue filings are surfaced, ancient ones assumed filed
    expect(filings.some((f) => f.daysLeft < 0)).toBe(true);
    expect(filings.every((f) => f.daysLeft >= -45)).toBe(true);
  });
});

describe("banking ingestion", () => {
  const lines = [
    { date: "2026-06-01", description: "AWS subscription June", amount: parseINR("-8,000"), reference: "utr_1" },
    { date: "2026-06-05", description: "Office rent June", amount: parseINR("-60,000"), reference: "utr_2" },
    { date: "2026-06-07", description: "NEFT from mystery sender", amount: parseINR("25,000"), reference: "utr_3" },
  ];

  it("auto-posts categorized lines and queues unknowns for review", () => {
    const org = freshOrg();
    const result = org.banking.importStatement(lines, "adarsh");
    expect(result.posted.length).toBe(2);
    expect(result.needsReview.length).toBe(1);
    expect(org.ledger.balance("acc_software", "2026-06-30")).toBe(parseINR("8,000"));
    expect(org.ledger.balance("acc_rent", "2026-06-30")).toBe(parseINR("60,000"));
    // unknown line was NOT guessed into an account
    expect(org.banking.pendingReview().length).toBe(1);
  });

  it("re-importing the same statement is idempotent", () => {
    const org = freshOrg();
    org.banking.importStatement(lines, "adarsh");
    const second = org.banking.importStatement(lines, "adarsh");
    expect(second.posted.length).toBe(0);
    expect(second.duplicates.length).toBe(3);
    expect(org.ledger.balance("acc_software", "2026-06-30")).toBe(parseINR("8,000")); // not doubled
  });

  it("categorizing a queued line posts it to the named account", () => {
    const org = freshOrg();
    org.banking.importStatement(lines, "adarsh");
    org.banking.categorize("utr_3", "acc_services", "adarsh");
    expect(org.ledger.balance("acc_services", "2026-06-30")).toBe(parseINR("25,000"));
    expect(org.banking.pendingReview().length).toBe(0);
  });

  it("categorizes back to the bank account the line was imported against", () => {
    const org = freshOrg();
    org.chart.add({ id: "acc_bank_2", code: "1011", name: "HDFC Current", type: "ASSET", parentId: null, isCashEquivalent: true, active: true });
    const bankBefore = org.ledger.balance("acc_bank", "2026-06-30");
    org.banking.importStatement(
      [{ date: "2026-06-07", description: "NEFT mystery inflow", amount: parseINR("25,000"), reference: "utr_x" }],
      "adarsh",
      "acc_bank_2",
    );
    org.banking.categorize("utr_x", "acc_services", "adarsh");
    // the counter-entry lands on the imported account, not the default acc_bank
    expect(org.ledger.balance("acc_bank_2", "2026-06-30")).toBe(parseINR("25,000"));
    expect(org.ledger.balance("acc_bank", "2026-06-30")).toBe(bankBefore);
  });
});

describe("recurring detection", () => {
  it("detects stable monthly payments and flags subscriptions", () => {
    const org = freshOrg();
    const post = (date: string, dr: string, amt: string, narration: string) =>
      org.journal.post({
        date,
        narration,
        lines: [
          { accountId: dr, side: "DEBIT", amount: parseINR(amt) },
          { accountId: "acc_bank", side: "CREDIT", amount: parseINR(amt) },
        ],
        sourceModule: "banking",
        createdBy: "adarsh",
      });
    for (const m of ["04", "05", "06"]) {
      post(`2026-${m}-05`, "acc_rent", "60,000", "Office rent");
      post(`2026-${m}-10`, "acc_software", "10,000", "Slack subscription");
    }
    post("2026-06-15", "acc_travel", "5,000", "Uber to airport"); // one-off, must not appear

    const summary = org.recurring.summary("2026-06-30");
    expect(summary.items.length).toBe(2);
    const rent = summary.items.find((i) => i.accountId === "acc_rent")!;
    expect(rent.monthlyAmount).toBe(parseINR("60,000"));
    expect(rent.annualizedCost).toBe(parseINR("7,20,000"));
    expect(rent.isSubscription).toBe(false);
    const slack = summary.items.find((i) => i.accountId === "acc_software")!;
    expect(slack.isSubscription).toBe(true);
    expect(summary.subscriptionMonthly).toBe(parseINR("10,000"));
  });
});

describe("forecast engine", () => {
  const burningStartup = () => {
    const org = freshOrg();
    const post = (date: string, dr: string, cr: string, amt: string, narration = "txn") =>
      org.journal.post({
        date,
        narration,
        lines: [
          { accountId: dr, side: "DEBIT", amount: parseINR(amt) },
          { accountId: cr, side: "CREDIT", amount: parseINR(amt) },
        ],
        sourceModule: "manual",
        createdBy: "adarsh",
      });
    post("2026-01-01", "acc_bank", "acc_capital", "30,00,000", "Seed");
    for (const m of ["04", "05", "06"]) {
      post(`2026-${m}-01`, "acc_salary", "acc_bank", "2,00,000", "Payroll");
      post(`2026-${m}-05`, "acc_rent", "acc_bank", "1,00,000", "Rent");
      post(`2026-${m}-15`, "acc_bank", "acc_sales", "1,00,000", "Sales");
    }
    return org;
  };

  it("reports monthly history straight off the ledger", () => {
    const org = burningStartup();
    const history = org.forecast.monthlyHistory("2026-06-30", 6);
    expect(history.length).toBe(6);
    const june = history.find((p) => p.month === "2026-06")!;
    expect(june.net).toBe(parseINR("-2,00,000"));
    expect(june.closingCash).toBe(parseINR("24,00,000"));
    expect(june.kind).toBe("actual");
  });

  it("projects forward at trailing-average burn and stays honest about it", () => {
    const org = burningStartup();
    const f = org.forecast.cashForecast("2026-06-30", 6, 3);
    expect(f.points.length).toBe(9);
    const projected = f.points.filter((p) => p.kind === "forecast");
    expect(projected.map((p) => p.closingCash)).toEqual([
      parseINR("22,00,000"),
      parseINR("20,00,000"),
      parseINR("18,00,000"),
    ]);
    expect(f.assumption).toContain("trailing");
    expect(f.depletionMonth).toBeNull();
  });

  it("declines to project without history", () => {
    const org = freshOrg();
    const f = org.forecast.cashForecast("2026-06-30");
    expect(f.points.every((p) => p.kind === "actual")).toBe(true);
    expect(f.assumption).toContain("Insufficient");
  });

  it("simulates a hire and reports the new runway", () => {
    const org = burningStartup();
    const s = org.forecast.scenario("2026-06-30", {
      label: "Hire engineer",
      monthlyExpenseDelta: parseINR("1,00,000"),
    });
    expect(s.baselineBurn).toBe(parseINR("2,00,000"));
    expect(s.scenarioBurn).toBe(parseINR("3,00,000"));
    expect(s.baselineRunwayDays).toBe(360);
    expect(s.scenarioRunwayDays).toBe(240);
    expect(s.verdict).toContain("240");
  });

  it("flags an unaffordable one-time cost", () => {
    const org = burningStartup();
    const s = org.forecast.scenario("2026-06-30", {
      label: "Buy office",
      oneTimeCost: parseINR("30,00,000"),
    });
    expect(s.verdict).toContain("Not affordable");
  });
});

describe("recommendation engine + approval queue", () => {
  const orgWithProblems = () => {
    const org = freshOrg();
    org.journal.post({
      date: "2026-01-05",
      narration: "Seed",
      lines: [
        { accountId: "acc_bank", side: "DEBIT", amount: parseINR("40,00,000") },
        { accountId: "acc_capital", side: "CREDIT", amount: parseINR("40,00,000") },
      ],
      sourceModule: "manual",
      createdBy: "adarsh",
    });
    const inv = org.invoices.create(
      {
        number: "INV-100",
        customer: "SlowPay Ltd",
        issueDate: "2026-05-01",
        dueDate: "2026-06-01",
        lines: [{ description: "Retainer", amount: parseINR("3,00,000"), gstRatePct: 18 }],
      },
      "adarsh",
    );
    org.invoices.send(inv.id, "adarsh");
    return org;
  };

  it("generates recommendations with problem, impact, confidence, and risk", () => {
    const org = orgWithProblems();
    const recs = org.recommendations.generate("2026-07-02", "2026-01-01");
    const overdue = recs.find((r) => r.kind === "overdue_invoices")!;
    expect(overdue.problem).toContain("SlowPay");
    expect(overdue.impact).toBe(parseINR("3,54,000"));
    expect(overdue.confidence).toBe("high");
    expect(overdue.risk).toBe("low");
    expect(overdue.status).toBe("pending");

    // GSTR-1 for June is due 2026-07-11 — within 10 days of 2026-07-02
    const gst = recs.find((r) => r.kind === "gst_filing");
    expect(gst).toBeDefined();
    expect(gst!.requiresApproval).toBe(true); // regulatory submission — never automatic
  });

  it("approve/dismiss are sticky across regeneration and audited", () => {
    const org = orgWithProblems();
    const recs = org.recommendations.generate("2026-07-02", "2026-01-01");
    const target = recs.find((r) => r.kind === "overdue_invoices")!;
    org.recommendations.approve(target.id, "adarsh");

    const regenerated = org.recommendations.generate("2026-07-02", "2026-01-01");
    const same = regenerated.find((r) => r.id === target.id)!;
    expect(same.status).toBe("approved");
    expect(same.decidedBy).toBe("adarsh");
    expect(() => org.recommendations.approve(target.id, "adarsh")).toThrow(/already/);

    const audit = org.bus.audit(org.orgId);
    expect(audit.some((e) => e.type === "recommendation.approved")).toBe(true);
  });
});

describe("morning brief", () => {
  it("composes health, cash, deltas, filings, and a headline from engine data", () => {
    const org = freshOrg();
    org.journal.post({
      date: "2026-01-05",
      narration: "Seed",
      lines: [
        { accountId: "acc_bank", side: "DEBIT", amount: parseINR("20,00,000") },
        { accountId: "acc_capital", side: "CREDIT", amount: parseINR("20,00,000") },
      ],
      sourceModule: "manual",
      createdBy: "adarsh",
    });
    const inv = org.invoices.create(
      {
        number: "INV-200",
        customer: "Acme",
        issueDate: "2026-06-01",
        dueDate: "2026-06-15",
        lines: [{ description: "Sprint", amount: parseINR("2,00,000"), gstRatePct: 18 }],
      },
      "adarsh",
    );
    org.invoices.send(inv.id, "adarsh");
    org.recommendations.generate("2026-07-02", "2026-01-01");

    const brief = org.brief.compose("2026-07-02", "2026-01-01");
    expect(brief.cashOnHand).toBe(parseINR("20,00,000"));
    expect(brief.overdueCount).toBe(1);
    expect(brief.overdueAmount).toBe(parseINR("2,36,000"));
    expect(brief.nextFiling).not.toBeNull();
    expect(brief.headline.length).toBeGreaterThan(10);
    expect(brief.health.score).toBeGreaterThanOrEqual(0);
  });
});

describe("upgraded health score", () => {
  it("scores receivables discipline and revenue growth when data exists", () => {
    const org = freshOrg();
    const post = (date: string, dr: string, cr: string, amt: string) =>
      org.journal.post({
        date,
        narration: "txn",
        lines: [
          { accountId: dr, side: "DEBIT", amount: parseINR(amt) },
          { accountId: cr, side: "CREDIT", amount: parseINR(amt) },
        ],
        sourceModule: "manual",
        createdBy: "adarsh",
      });
    post("2026-01-01", "acc_bank", "acc_capital", "10,00,000");
    post("2026-05-10", "acc_bank", "acc_sales", "1,00,000");
    post("2026-06-10", "acc_bank", "acc_sales", "1,20,000");

    const h = org.health.score("2026-07-02", "2026-01-01");
    expect(h.components.length).toBeGreaterThanOrEqual(6);
    const growth = h.components.find((c) => c.name === "Revenue growth")!;
    expect(growth.dataAvailable).toBe(true);
    expect(growth.detail).toContain("grew");
    const receivables = h.components.find((c) => c.name === "Receivables")!;
    expect(receivables.dataAvailable).toBe(true);
    expect(receivables.score).toBe(100); // no open receivables
  });
});

describe("AI CFO end-to-end with the deterministic planner", () => {
  const setup = () => {
    const platform = new Platform();
    const org = platform.createOrganization("org_ai", "AI Test Co");
    const post = (date: string, dr: string, cr: string, amt: string, narration = "txn") =>
      org.journal.post({
        date,
        narration,
        lines: [
          { accountId: dr, side: "DEBIT", amount: parseINR(amt) },
          { accountId: cr, side: "CREDIT", amount: parseINR(amt) },
        ],
        sourceModule: "manual",
        createdBy: "adarsh",
      });
    post("2026-01-01", "acc_bank", "acc_capital", "30,00,000", "Seed");
    for (const m of ["04", "05", "06"]) {
      post(`2026-${m}-01`, "acc_salary", "acc_bank", "2,00,000", "Payroll");
      post(`2026-${m}-15`, "acc_bank", "acc_sales", "1,00,000", "Sales");
    }
    const inv = org.invoices.create(
      {
        number: "INV-300",
        customer: "SlowPay",
        issueDate: "2026-05-01",
        dueDate: "2026-06-01",
        lines: [{ description: "Work", amount: parseINR("1,00,000"), gstRatePct: 18 }],
      },
      "adarsh",
    );
    org.invoices.send(inv.id, "adarsh");

    const user: AiUser = {
      userId: "adarsh",
      orgId: "org_ai",
      permissions: new Set<Permission>(["access_ai_cfo", "view_reports"]),
    };
    const orchestrator = new Orchestrator(new CfoPlanner({ asOf: "2026-07-02", periodFrom: "2026-01-01" }));
    return { org, user, orchestrator };
  };

  it("answers a runway question with verified, tool-sourced figures", async () => {
    const { org, user, orchestrator } = setup();
    const record = await orchestrator.ask(user, org, "How long can we survive at this burn?");
    expect(record.verified).toBe(true);
    expect(record.toolsInvoked.map((t) => t.tool)).toContain("get_burn_and_runway");
    expect(record.finalAnswer).toContain("₹");
  });

  it("routes invoice questions to the invoice tools", async () => {
    const { org, user, orchestrator } = setup();
    const record = await orchestrator.ask(user, org, "Show unpaid invoices");
    expect(record.toolsInvoked.map((t) => t.tool)).toContain("list_overdue_invoices");
    expect(record.finalAnswer).toContain("SlowPay");
  });

  it("simulates hiring when asked", async () => {
    const { org, user, orchestrator } = setup();
    const record = await orchestrator.ask(user, org, "Can I hire another employee at ₹80,000 per month?");
    expect(record.toolsInvoked.map((t) => t.tool)).toContain("simulate_scenario");
    expect(record.verified).toBe(true);
  });

  it("falls back to the morning brief for open questions", async () => {
    const { org, user, orchestrator } = setup();
    const record = await orchestrator.ask(user, org, "Good morning!");
    expect(record.toolsInvoked.map((t) => t.tool)).toContain("get_morning_brief");
    expect(record.verified).toBe(true);
  });
});
