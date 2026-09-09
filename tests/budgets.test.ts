/**
 * Budgets, and the agent that reads them.
 *
 * What is under test is not the arithmetic — actual minus budget is not
 * interesting. It is the judgement around it: that an unbudgeted account
 * stays silent, that good news never interrupts anyone, and that the agent
 * and the budget report cannot disagree about what counts as off-plan.
 */

import { describe, it, expect } from "vitest";
import { Platform, parseINR } from "../src/index.js";
import { attachErp } from "../src/erp/suite.js";
import { BudgetEngine, BudgetError } from "../src/erp/budgets.js";
import { EventBus } from "../src/events.js";
import { ZERO, type Paise } from "../src/money.js";

const ACTOR = "priya";

const spend = (org: ReturnType<Platform["createOrganization"]>, date: string, narration: string, amount: Paise, accountId = "acc_software") =>
  org.journal.post({
    date,
    narration,
    lines: [
      { accountId, side: "DEBIT", amount },
      { accountId: "acc_bank", side: "CREDIT", amount },
    ],
    sourceModule: "manual",
    createdBy: ACTOR,
  });

const company = (orgId: string) => {
  const platform = new Platform();
  const org = platform.createOrganization(orgId, "Nimbus Labs");
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
  return { org, erp };
};

describe("BudgetEngine", () => {
  const CHART: Record<string, { name: string; type: "REVENUE" | "EXPENSE" }> = {
    acc_software: { name: "Software", type: "EXPENSE" },
    acc_salary: { name: "Salary", type: "EXPENSE" },
    acc_marketing: { name: "Marketing", type: "EXPENSE" },
    acc_travel: { name: "Travel", type: "EXPENSE" },
    acc_revenue: { name: "Revenue", type: "REVENUE" },
  };
  const bare = () =>
    new BudgetEngine("org_b", new EventBus(), (id) => {
      const account = CHART[id];
      if (!account) throw new BudgetError(`${id} cannot carry a budget`);
      return account;
    });

  it("refuses a negative budget rather than quietly flipping its sign", () => {
    expect(() =>
      bare().set("2026-01", [{ accountId: "acc_software", amount: parseINR("-10,000") }], ACTOR),
    ).toThrow(BudgetError);
  });

  it("replaces a re-set budget instead of accumulating two plans", () => {
    const budgets = bare();
    budgets.set("2026-01", [{ accountId: "acc_software", amount: parseINR("50,000") }], ACTOR);
    budgets.set("2026-01", [{ accountId: "acc_software", amount: parseINR("80,000") }], ACTOR);

    expect(budgets.forPeriod("2026-01")).toHaveLength(1);
    expect(budgets.get("2026-01", "acc_software")!.amount).toBe(parseINR("80,000"));
  });

  it("keeps budgets in the period they were set for", () => {
    const budgets = bare();
    budgets.set("2026-01", [{ accountId: "acc_software", amount: parseINR("50,000") }], ACTOR);
    expect(budgets.get("2026-02", "acc_software")).toBeNull();
  });

  it("says nothing about an account nobody budgeted", () => {
    const report = bare().variance("2026-01", [
      { accountId: "acc_travel", name: "Travel", type: "EXPENSE", amount: parseINR("5,00,000") },
    ]);
    expect(report.lines, "an unplanned account is missing data, not a variance").toHaveLength(0);
  });

  it("reads a budgeted account with no spend as spending nothing", () => {
    const budgets = bare();
    budgets.set("2026-01", [{ accountId: "acc_marketing", amount: parseINR("2,00,000") }], ACTOR);

    const line = budgets.variance("2026-01", [])!.lines[0]!;
    expect(line.actual).toBe(ZERO);
    expect(line.unfavourable, "underspending is not a breach").toBe(false);
    expect(line.breach).toBe(false);
  });

  it("still knows a revenue line is revenue when it earned nothing at all", () => {
    const budgets = bare();
    budgets.set("2026-01", [{ accountId: "acc_revenue", amount: parseINR("6,00,000") }], ACTOR);

    // The P&L omits an account that never moved, so this is the shape the
    // report actually gets — and reading the type off the missing row once
    // turned a total revenue miss into a saving.
    const line = budgets.variance("2026-01", []).lines[0]!;
    expect(line.type).toBe("REVENUE");
    expect(line.unfavourable).toBe(true);
    expect(line.breach).toBe(true);
  });

  it("refuses a budget on an account that cannot carry one", () => {
    expect(() => bare().set("2026-01", [{ accountId: "acc_bank", amount: parseINR("1,00,000") }], ACTOR)).toThrow(
      BudgetError,
    );
  });

  it("calls a revenue shortfall unfavourable and a revenue beat not", () => {
    const budgets = bare();
    budgets.set("2026-01", [{ accountId: "acc_revenue", amount: parseINR("10,00,000") }], ACTOR);

    const short = budgets.variance("2026-01", [
      { accountId: "acc_revenue", name: "Revenue", type: "REVENUE", amount: parseINR("6,00,000") },
    ]).lines[0]!;
    expect(short.unfavourable).toBe(true);
    expect(short.breach).toBe(true);

    const beat = budgets.variance("2026-01", [
      { accountId: "acc_revenue", name: "Revenue", type: "REVENUE", amount: parseINR("14,00,000") },
    ]).lines[0]!;
    expect(beat.unfavourable).toBe(false);
    expect(beat.breach).toBe(false);
  });

  it("needs both a rupee floor and a percentage, not either", () => {
    const budgets = bare();
    budgets.set(
      "2026-01",
      [
        // 40% over, but only ₹2,000 — a percentage of very little.
        { accountId: "acc_software", amount: parseINR("5,000") },
        // ₹1,00,000 over, but 2% of the plan — noise at that scale.
        { accountId: "acc_salary", amount: parseINR("50,00,000") },
      ],
      ACTOR,
    );

    const lines = budgets.variance("2026-01", [
      { accountId: "acc_software", name: "Software", type: "EXPENSE", amount: parseINR("7,000") },
      { accountId: "acc_salary", name: "Salary", type: "EXPENSE", amount: parseINR("51,00,000") },
    ]).lines;

    expect(lines.every((l) => l.unfavourable)).toBe(true);
    expect(lines.some((l) => l.breach), "neither test alone should raise a finding").toBe(false);
  });

  it("lets the rupee floor decide when the plan was zero", () => {
    const budgets = bare();
    budgets.set("2026-01", [{ accountId: "acc_travel", amount: ZERO }], ACTOR);

    const line = budgets.variance("2026-01", [
      { accountId: "acc_travel", name: "Travel", type: "EXPENSE", amount: parseINR("3,00,000") },
    ]).lines[0]!;
    expect(line.varianceBps, "there is no percentage of zero").toBeNull();
    expect(line.breach).toBe(true);
  });
});

describe("BUDGET_VARIANCE agent", () => {
  it("raises the breach, names what drove it, and proposes no entry", () => {
    const { org, erp } = company("org_bv1");
    erp.budgets.set("2026-01", [{ accountId: "acc_software", amount: parseINR("1,00,000") }], ACTOR);
    spend(org, "2026-01-08", "Datadog annual plan", parseINR("2,50,000"));
    spend(org, "2026-01-19", "Vercel Pro", parseINR("40,000"));

    erp.agents.scan("2026-01", ACTOR);
    const found = erp.agents.open().filter((p) => p.kind === "BUDGET_VARIANCE");

    expect(found).toHaveLength(1);
    expect(found[0]!.title).toContain("Software");
    expect(found[0]!.rationale, "a finding you cannot drill into is a rumour").toContain("Datadog annual plan");
    expect(found[0]!.evidence.length).toBeGreaterThan(0);
    expect(found[0]!.proposedEntry, "the books are right; the spend is the problem").toBeNull();
  });

  it("stays quiet when spend is on plan", () => {
    const { org, erp } = company("org_bv2");
    erp.budgets.set("2026-01", [{ accountId: "acc_software", amount: parseINR("3,00,000") }], ACTOR);
    spend(org, "2026-01-08", "Datadog", parseINR("2,90,000"));

    erp.agents.scan("2026-01", ACTOR);
    expect(erp.agents.open().filter((p) => p.kind === "BUDGET_VARIANCE")).toHaveLength(0);
  });

  it("agrees with the budget report about what is a breach", () => {
    const { org, erp } = company("org_bv3");
    erp.budgets.set(
      "2026-01",
      [
        { accountId: "acc_software", amount: parseINR("1,00,000") },
        { accountId: "acc_salary", amount: parseINR("50,00,000") },
      ],
      ACTOR,
    );
    spend(org, "2026-01-08", "Datadog", parseINR("3,00,000"));
    spend(org, "2026-01-31", "January payroll", parseINR("51,00,000"), "acc_salary");

    erp.agents.scan("2026-01", ACTOR);
    const raised = erp.agents.open().filter((p) => p.kind === "BUDGET_VARIANCE");
    const breaches = erp.budgets
      .variance("2026-01", [
        { accountId: "acc_software", name: "Software", type: "EXPENSE", amount: parseINR("3,00,000") },
        { accountId: "acc_salary", name: "Salary", type: "EXPENSE", amount: parseINR("51,00,000") },
      ])
      .lines.filter((l) => l.breach);

    expect(raised).toHaveLength(breaches.length);
    expect(raised.map((p) => p.title.split(":")[0])).toEqual(breaches.map((l) => l.name));
  });

  it("does not pile up a second finding on a re-scan", () => {
    const { org, erp } = company("org_bv4");
    erp.budgets.set("2026-01", [{ accountId: "acc_software", amount: parseINR("1,00,000") }], ACTOR);
    spend(org, "2026-01-08", "Datadog", parseINR("3,00,000"));

    erp.agents.scan("2026-01", ACTOR);
    // More of the same overspend, so the finding's title changes with it.
    // Keyed on the title this raised a second finding about one account.
    spend(org, "2026-01-20", "Datadog overage", parseINR("50,000"));
    erp.agents.scan("2026-01", ACTOR);

    expect(erp.agents.all().filter((p) => p.kind === "BUDGET_VARIANCE")).toHaveLength(1);
  });
});
