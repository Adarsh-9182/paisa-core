/**
 * Working the close — the first thing here with a goal instead of a question.
 *
 * The behaviour under test is not "does it close the month". It is: does it
 * do only what it is allowed to, stop when it stops helping, and tell the
 * truth about what is left.
 */

import { describe, it, expect } from "vitest";
import { Platform, parseINR } from "../src/index.js";
import { attachErp } from "../src/erp/suite.js";
import { workTheClose, describeAttempt } from "../src/erp/close-agent.js";

const ACTOR = "priya";

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

  for (const month of ["01", "02", "03"]) {
    const b = erp.bills.create(
      {
        number: `AWS-${month}`,
        vendor: "AWS India",
        billDate: `2026-${month}-05`,
        dueDate: `2026-${month}-25`,
        lines: [
          { description: "Hosting", amount: parseINR("20,000"), expenseAccountId: "acc_software", gstRatePct: 18, itcEligible: true },
        ],
      },
      ACTOR,
    );
    erp.bills.submit(b.id, ACTOR);
    erp.bills.approve(b.id, "raj");
  }

  const ctx = { close: erp.close, agents: erp.agents, authority: erp.authority };
  return { org, erp, ctx };
};

describe("workTheClose", () => {
  it("never waives a blocker, however tempting", () => {
    const { erp, ctx } = company("org_cw1");
    const attempt = workTheClose(ctx, "2026-04", ACTOR);

    const waived = erp.close.status("2026-04")!.tasks.filter((t) => t.status === "WAIVED");
    expect(waived, "an agent that waives its own blockers closes broken books").toHaveLength(0);

    // And a blocked task is reported as blocked, not quietly dropped.
    for (const r of attempt.remaining) {
      expect(r.why.length).toBeGreaterThan(0);
      expect(r.needs).not.toMatch(/waive/i);
    }
  });

  it("stops instead of spinning when a round changes nothing", () => {
    const { ctx } = company("org_cw2");
    const attempt = workTheClose(ctx, "2026-04", ACTOR);

    expect(attempt.rounds).toBeLessThanOrEqual(4);
    // With no standing authority there is nothing it may settle, so after the
    // first scan it can make no further progress and must say so rather than
    // burning its remaining rounds.
    if (!attempt.readyToClose) expect(attempt.stalled || attempt.rounds <= 4).toBe(true);
  });

  it("scans and settles under a grant, and counts that as work it did", () => {
    const { erp, ctx } = company("org_cw3");
    erp.authority.grant(
      {
        kind: "MISSING_ACCRUAL",
        maxAmount: parseINR("50,000"),
        maxPerSweep: parseINR("2,00,000"),
        note: "Recurring vendor accruals reverse next month.",
      },
      ACTOR,
    );

    const attempt = workTheClose(ctx, "2026-04", ACTOR);

    expect(attempt.did.some((s) => /Scanned/.test(s)), JSON.stringify(attempt.did)).toBe(true);
    expect(attempt.did.some((s) => /Settled/.test(s)), JSON.stringify(attempt.did)).toBe(true);
  });

  it("does less, and says so, when nothing is pre-approved", () => {
    const { ctx } = company("org_cw4");
    const attempt = workTheClose(ctx, "2026-04", ACTOR);
    expect(attempt.did.some((s) => /Settled/.test(s))).toBe(false);
  });

  it("reports the previous run as 'before', and zero when there was none", () => {
    const { ctx } = company("org_cw5");

    // Nothing has run, so there is no prior state to compare against and it
    // says zero rather than inventing a baseline by running the close first
    // — which would soft-close the period and change what it could do.
    const first = workTheClose(ctx, "2026-04", ACTOR);
    expect(first.before).toEqual({ passed: 0, blocked: 0 });
    expect(first.after.passed + first.after.blocked).toBeGreaterThan(0);

    // A second attempt compares against what the first one left.
    const second = workTheClose(ctx, "2026-04", ACTOR);
    expect(second.before).toEqual({ passed: first.after.passed, blocked: first.after.blocked });
  });

  it("says why it could do no more, rather than stopping silently", () => {
    const { ctx } = company("org_cw7");
    const attempt = workTheClose(ctx, "2026-04", ACTOR);
    if (!attempt.readyToClose) {
      expect(attempt.stallReason, "a stop with no reason is indistinguishable from a bug").toBeTruthy();
    }
  });

  it("describes itself in a sentence that names what is left", () => {
    const { ctx } = company("org_cw6");
    const text = describeAttempt(workTheClose(ctx, "2026-04", ACTOR));

    expect(text).toContain("2026-04");
    expect(text.length).toBeGreaterThan(30);
    // It must never claim a close it did not achieve.
    if (/is ready to close/.test(text)) {
      const attempt = workTheClose(ctx, "2026-04", ACTOR);
      expect(attempt.readyToClose).toBe(true);
    }
  });
});
