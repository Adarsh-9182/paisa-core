/**
 * Flow handlers, against real engines rather than stubs.
 *
 * The point of these tests is the two behaviours that only appear once a
 * handler is wired to a ledger: that a catch-up run posts into the period it
 * was due for rather than today's, and that a judging flow leaves the ledger
 * untouched no matter how many times it runs.
 */

import { describe, it, expect } from "vitest";
import { Platform, parseINR } from "../src/index.js";
import { attachErp } from "../src/erp/suite.js";
import { standardHandlers } from "../src/erp/flow-handlers.js";
import { flowById, FLOW_TASKS } from "../src/erp/flow-catalog.js";
import { runDue, inMemoryFlowStore, type FlowDefinition } from "../src/erp/flows.js";

const ACTOR = "flow-runner";

/** A company with cash and one prepaid spread straight-line over six months. */
const company = () => {
  const platform = new Platform();
  const org = platform.createOrganization("org_flows", "Nimbus Labs");
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

  // ₹6,00,000 of licences across Jan–Jun: ₹1,00,000 a month.
  erp.schedules.addPrepaid(
    {
      description: "Annual software licences",
      total: parseINR("6,00,000"),
      startPeriod: "2026-01",
      endPeriod: "2026-06",
      expenseAccountId: "acc_software",
      fundingAccountId: "acc_bank",
      inceptionDate: "2026-01-01",
    },
    ACTOR,
  );

  return { org, erp, deps: { org, erp, actor: ACTOR } };
};

const flow = (id: string, over: Partial<FlowDefinition> = {}): FlowDefinition => ({
  ...flowById(id)!,
  enabled: true,
  ...over,
});

describe("prepaid amortisation — an executing flow", () => {
  it("posts the month it was due for, not the month it ran in", async () => {
    const { org, erp, deps } = company();
    const store = inMemoryFlowStore();

    // Nothing ran until April, so January through April are all owed.
    await runDue(
      [flow("flow_prepaid_amortisation", { startDate: "2026-01-01" })],
      standardHandlers(deps),
      store,
      "2026-04-01",
    );

    // Four months of ₹1,00,000 each, each landing in its own period.
    expect(org.ledger.balance("acc_software", "2026-01-31")).toBe(parseINR("1,00,000"));
    expect(org.ledger.balance("acc_software", "2026-02-28")).toBe(parseINR("2,00,000"));
    expect(org.ledger.balance("acc_software", "2026-04-30")).toBe(parseINR("4,00,000"));
    expect(erp.schedules.prepaidRemaining("2026-04")).toBe(parseINR("2,00,000"));
  });

  it("names the period and the amount in the summary", async () => {
    const { deps } = company();
    const runs = await runDue(
      [flow("flow_prepaid_amortisation", { startDate: "2026-01-01" })],
      standardHandlers(deps),
      inMemoryFlowStore(),
      "2026-01-01",
    );
    expect(runs[0]!.status).toBe("ok");
    expect(runs[0]!.summary).toContain("2026-01");
    expect(runs[0]!.summary).toContain("₹1,00,000.00");
  });

  it("does not post twice when the sweep runs again", async () => {
    const { org, deps } = company();
    const store = inMemoryFlowStore();
    const f = [flow("flow_prepaid_amortisation", { startDate: "2026-01-01" })];

    await runDue(f, standardHandlers(deps), store, "2026-02-01");
    const after = org.ledger.balance("acc_software", "2026-02-28");
    await runDue(f, standardHandlers(deps), store, "2026-02-01");

    expect(org.ledger.balance("acc_software", "2026-02-28")).toBe(after);
  });

  it("reports nothing due once the schedule is exhausted", async () => {
    const { deps } = company();
    const runs = await runDue(
      [flow("flow_prepaid_amortisation", { startDate: "2026-09-01" })],
      standardHandlers(deps),
      inMemoryFlowStore(),
      "2026-09-01",
    );
    expect(runs[0]!.summary).toContain("No prepaid amortisation due");
  });
});

describe("judging flows never post", () => {
  const ledgerFingerprint = (org: ReturnType<typeof company>["org"]) =>
    JSON.stringify([
      org.ledger.balance("acc_bank", "2026-12-31"),
      org.ledger.balance("acc_software", "2026-12-31"),
      org.ledger.balance("acc_ar", "2026-12-31"),
    ].map(String));

  for (const id of ["flow_pre_close_scan", "flow_control_monitor", "flow_bad_debt", "flow_ar_reminders"]) {
    it(`${id} leaves the ledger untouched`, async () => {
      const { org, deps } = company();
      const before = ledgerFingerprint(org);

      await runDue(
        [flow(id, { startDate: "2026-03-01" })],
        standardHandlers(deps),
        inMemoryFlowStore(),
        "2026-03-31",
      );

      expect(ledgerFingerprint(org)).toBe(before);
    });
  }

  it("raises each finding once even when the monitor runs every day for a month", async () => {
    const { erp, deps } = company();
    const store = inMemoryFlowStore();
    const f = [flow("flow_control_monitor", { startDate: "2026-03-01" })];

    await runDue(f, standardHandlers(deps), store, "2026-03-31");
    const openAfterFirstSweep = erp.agents.open().length;

    // A second sweep over the same days raises nothing new: `scan` dedupes on
    // kind, period and title, so a daily monitor does not refile its findings.
    await runDue(f, standardHandlers(deps), store, "2026-03-31");
    expect(erp.agents.open().length).toBe(openAfterFirstSweep);
  });

  it("returns the ids of what it raised, so the review queue can link to them", async () => {
    const { erp, deps } = company();
    const runs = await runDue(
      [flow("flow_pre_close_scan", { startDate: "2026-03-01" })],
      standardHandlers(deps),
      inMemoryFlowStore(),
      "2026-03-01",
    );

    const ok = runs.find((r) => r.status === "ok")!;
    for (const id of ok.proposalIds) expect(() => erp.agents.get(id)).not.toThrow();
  });
});

describe("pre-close scan looks at the month that ended", () => {
  it("scans August when it fires on the 1st of September", async () => {
    const { deps } = company();
    const runs = await runDue(
      [flow("flow_pre_close_scan", { startDate: "2026-09-01" })],
      standardHandlers(deps),
      inMemoryFlowStore(),
      "2026-09-01",
    );
    // Scanning September on its first day would report on a period one day old.
    expect(runs[0]!.summary).toContain("2026-08");
  });
});

describe("reporting flows", () => {
  it("summarises cash without touching the books", async () => {
    const { deps } = company();
    const runs = await runDue(
      [flow("flow_cash_forecast", { startDate: "2026-03-01" })],
      standardHandlers(deps),
      inMemoryFlowStore(),
      "2026-03-31",
    );
    expect(runs.find((r) => r.status === "ok")!.summary).toMatch(/on hand/);
  });

  it("reports the digest with ARR, cash and the review backlog", async () => {
    const { deps } = company();
    const runs = await runDue(
      [flow("flow_cfo_digest", { startDate: "2026-03-01" })],
      standardHandlers(deps),
      inMemoryFlowStore(),
      "2026-03-31",
    );
    const summary = runs.find((r) => r.status === "ok")!.summary;
    expect(summary).toContain("ARR");
    expect(summary).toContain("awaiting review");
  });

  it("says plainly when there is nothing to chase", async () => {
    const { deps } = company();
    const runs = await runDue(
      [flow("flow_ar_reminders", { startDate: "2026-03-01" })],
      standardHandlers(deps),
      inMemoryFlowStore(),
      "2026-03-31",
    );
    expect(runs.find((r) => r.status === "ok")!.summary).toContain("No customer has");
  });

  it("reports bills awaiting approval", async () => {
    const { deps } = company();
    const runs = await runDue(
      [flow("flow_vendor_bill_alert", { startDate: "2026-03-01" })],
      standardHandlers(deps),
      inMemoryFlowStore(),
      "2026-03-31",
    );
    expect(runs.find((r) => r.status === "ok")!.summary).toMatch(/bills? awaiting approval|No bills/);
  });
});

describe("registry", () => {
  it("registers a handler for every task the catalogue names", () => {
    const { deps } = company();
    const registry = standardHandlers(deps);
    for (const task of Object.values(FLOW_TASKS)) {
      expect(registry.has(task), task).toBe(true);
    }
  });

  it("runs the whole catalogue without a single flow failing", async () => {
    const { deps } = company();
    const all = [
      "flow_prepaid_amortisation",
      "flow_deferred_revenue",
      "flow_pre_close_scan",
      "flow_control_monitor",
      "flow_ar_reminders",
      "flow_cash_forecast",
      "flow_cfo_digest",
      "flow_board_summary",
      "flow_bad_debt",
      "flow_vendor_bill_alert",
    ].map((id) => flow(id, { startDate: "2026-03-01" }));

    const runs = await runDue(all, standardHandlers(deps), inMemoryFlowStore(), "2026-03-31");

    const failed = runs.filter((r) => r.status === "failed");
    expect(failed.map((f) => `${f.flowId}: ${f.error}`)).toEqual([]);
    expect(runs.filter((r) => r.status === "ok").length).toBeGreaterThan(0);
  });
});
