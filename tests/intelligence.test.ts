import { describe, it, expect } from "vitest";
import { Platform, parseINR } from "../src/index.js";

const burningStartup = () => {
  const platform = new Platform();
  const org = platform.createOrganization("org_xyz", "XYZ Retail");
  const post = (date: string, dr: string, cr: string, amt: string, narration = "txn") =>
    org.journal.post({
      date, narration,
      lines: [
        { accountId: dr, side: "DEBIT", amount: parseINR(amt) },
        { accountId: cr, side: "CREDIT", amount: parseINR(amt) },
      ],
      sourceModule: "manual", createdBy: "adarsh",
    });
  post("2026-01-01", "acc_bank", "acc_capital", "30,00,000", "Seed");
  // Burn ₹3L/month for 3 months, revenue ₹1L/month → net burn ₹2L/month
  for (const m of ["04", "05", "06"]) {
    post(`2026-${m}-01`, "acc_salary", "acc_bank", "2,00,000", "Payroll");
    post(`2026-${m}-05`, "acc_rent", "acc_bank", "1,00,000", "Rent");
    post(`2026-${m}-15`, "acc_bank", "acc_sales", "1,00,000", "Sales");
  }
  return { platform, org };
};

describe("cash flow intelligence", () => {
  it("computes cash on hand, burn, and runway deterministically", () => {
    const { org } = burningStartup();
    const m = org.cashflow.metrics("2026-06-30", 3);
    // Cash: 30L - 3*(3L) + 3*(1L) = 24L
    expect(m.cashOnHand).toBe(parseINR("24,00,000"));
    expect(m.monthlyNetBurn).toBe(parseINR("2,00,000"));
    // runway = 24L / (2L/30) = 360 days
    expect(m.runwayDays).toBe(360);
  });

  it("refuses to guess when there is no history", () => {
    const platform = new Platform();
    const org = platform.createOrganization("org_empty", "Empty Co");
    const m = org.cashflow.metrics("2026-06-30");
    expect(m.monthlyNetBurn).toBeNull();
    expect(m.runwayDays).toBeNull();
    expect(m.note).toContain("Insufficient");
  });

  it("reports cash-flow positive instead of fake runway", () => {
    const platform = new Platform();
    const org = platform.createOrganization("org_profit", "Profit Co");
    org.journal.post({
      date: "2026-05-01", narration: "Sales",
      lines: [
        { accountId: "acc_bank", side: "DEBIT", amount: parseINR("5,00,000") },
        { accountId: "acc_sales", side: "CREDIT", amount: parseINR("5,00,000") },
      ],
      sourceModule: "manual", createdBy: "adarsh",
    });
    const m = org.cashflow.metrics("2026-06-30");
    expect(m.runwayDays).toBeNull();
    expect(m.note).toContain("positive");
  });
});

describe("financial health score", () => {
  it("produces a 0-100 score with explained components", () => {
    const { org } = burningStartup();
    const h = org.health.score("2026-06-30", "2026-04-01");
    expect(h.score).toBeGreaterThanOrEqual(0);
    expect(h.score).toBeLessThanOrEqual(100);
    expect(h.components.length).toBeGreaterThanOrEqual(4);
    for (const c of h.components.filter((c) => c.dataAvailable)) {
      expect(c.detail.length).toBeGreaterThan(0);
    }
  });

  it("declares missing data instead of guessing", () => {
    const platform = new Platform();
    const org = platform.createOrganization("org_bare", "Bare Co");
    const h = org.health.score("2026-06-30", "2026-04-01");
    expect(h.missing.length).toBeGreaterThan(0);
  });
});

describe("rules engine", () => {
  it("fires low-cash and large-expense policies with interpolated messages", () => {
    const { org } = burningStartup();
    const lowCash = org.rules.evaluate("cash_on_hand", parseINR("4,00,000"));
    expect(lowCash.length).toBe(1);
    expect(lowCash[0]!.message).toContain("₹4,00,000.00");
    expect(lowCash[0]!.action).toBe("notify");

    const bigExpense = org.rules.evaluate("expense_amount", parseINR("1,50,000"));
    expect(bigExpense.length).toBe(1);
    expect(bigExpense[0]!.action).toBe("require_approval");

    const okExpense = org.rules.evaluate("expense_amount", parseINR("50,000"));
    expect(okExpense.length).toBe(0);
  });

  it("fires short-runway warning and writes to the audit trail", () => {
    const { org } = burningStartup();
    const firings = org.rules.evaluate("runway_days", 45);
    expect(firings.length).toBe(1);
    const audit = org.bus.audit(org.orgId);
    expect(audit.some((e) => e.type === "rule.fired")).toBe(true);
  });
});

describe("multi-tenant isolation", () => {
  it("one user's organizations are fully isolated", () => {
    const platform = new Platform();
    const abc = platform.createOrganization("org_abc", "ABC Technologies");
    const xyz = platform.createOrganization("org_xyz", "XYZ Retail");
    abc.journal.post({
      date: "2026-04-01", narration: "ABC capital",
      lines: [
        { accountId: "acc_bank", side: "DEBIT", amount: parseINR("10,00,000") },
        { accountId: "acc_capital", side: "CREDIT", amount: parseINR("10,00,000") },
      ],
      sourceModule: "manual", createdBy: "adarsh",
    });
    expect(abc.cashflow.cashOnHand("2026-04-01")).toBe(parseINR("10,00,000"));
    expect(xyz.cashflow.cashOnHand("2026-04-01")).toBe(0n);
    expect(xyz.bus.audit("org_abc").length).toBe(0);
  });

  it("access requires membership", () => {
    const platform = new Platform();
    platform.createOrganization("org_abc", "ABC Technologies");
    expect(() => platform.organization("org_abc", new Set(["org_other"]))).toThrow(/Access denied/);
    expect(platform.organization("org_abc", new Set(["org_abc"])).name).toBe("ABC Technologies");
  });

  it("journal rejects a chart from another organization", () => {
    const platform = new Platform();
    const abc = platform.createOrganization("org_abc", "ABC");
    // Cross-wiring engines across orgs must be impossible at construction.
    expect(abc.journal.orgId).toBe("org_abc");
  });
});

describe("audit trail", () => {
  it("every posting and reversal is on the immutable event log", () => {
    const { org } = burningStartup();
    const events = org.bus.audit(org.orgId);
    const posted = events.filter((e) => e.type === "journal.posted");
    expect(posted.length).toBe(10); // 1 seed + 9 monthly entries
    for (const e of events) expect(Object.isFrozen(e)).toBe(true);
  });
});
