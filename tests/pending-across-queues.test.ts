/**
 * What the agent sees when asked "what needs me?"
 *
 * Paisa keeps two queues and they are not a duplication: `org.actions` holds
 * what the AI offered to do in a conversation and expires in an hour;
 * `erp.agents` holds findings about the books, tied to a period, which do not
 * expire because the books stay wrong until someone decides.
 *
 * `list_pending_actions` promised "everything the user has been asked to
 * approve" and read only the first. An agent asked what needed attention
 * would answer "nothing is waiting on your approval" with nine findings in a
 * queue — confident, short, and sounding like good news, which is the most
 * damaging shape a wrong answer takes.
 */

import { describe, it, expect } from "vitest";
import { Platform, parseINR } from "../src/index.js";
import { attachErp } from "../src/erp/suite.js";
import { TOOLS } from "../src/ai/tools.js";

const ACTOR = "priya";

/** A vendor that billed for three months and then did not. */
const companyWithAMissedBill = (orgId: string) => {
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
    erp.bills.approve(b.id, "raj"); // segregation of duties
  }

  return { org, erp };
};

describe("list_pending_actions covers both queues", () => {
  it("reports an agent finding that the drafts queue knows nothing about", () => {
    const { org, erp } = companyWithAMissedBill("org_pq1");

    const raised = erp.agents.scan("2026-04", ACTOR);
    // Without this the assertions below run over an empty queue and prove
    // nothing — the exact mistake this file exists to stop.
    expect(raised.length, "the scenario must actually raise a finding").toBeGreaterThan(0);
    expect(org.actions.pending()).toHaveLength(0);

    const out = TOOLS.list_pending_actions!(org, {});

    expect(out).toContain(`findings=${raised.length}`);
    expect(out).toContain("MISSING_ACCRUAL");
    // The old behaviour, which this replaces.
    expect(out).not.toContain("Nothing is waiting on your approval");
  });

  it("still says nothing is waiting when nothing is", () => {
    const { org } = companyWithAMissedBill("org_pq2");
    const out = TOOLS.list_pending_actions!(org, {});
    expect(out).toContain("Nothing is waiting on your approval");
  });

  it("tells the truth about what it could not check when there is no ERP layer", () => {
    const platform = new Platform();
    const org = platform.createOrganization("org_pq3", "Bare Books");

    const out = TOOLS.list_pending_actions!(org, {});
    // It must not imply it checked findings it had no way to see.
    expect(out).toContain("no ERP layer");
  });

  it("reports both queues together when both have something", () => {
    const { org, erp } = companyWithAMissedBill("org_pq4");
    erp.agents.scan("2026-04", ACTOR);

    org.actions.propose({
      kind: "categorize",
      summary: "Categorise ₹12,000 to Software",
      detail: "Bank line BNK-1 → 5300 Software",
      proposedBy: "paisa",
      effect: () => "categorised",
    });

    const out = TOOLS.list_pending_actions!(org, {});
    expect(out).toMatch(/pending_actions=1/);
    expect(out).toMatch(/findings=[1-9]/);
    expect(out).toContain("categorize");
    expect(out).toContain("MISSING_ACCRUAL");
  });
});

describe("attachErp records itself on the org", () => {
  it("leaves org.erp reachable, because that is how the tools find it", () => {
    const platform = new Platform();
    const org = platform.createOrganization("org_pq5", "Nimbus Labs");
    expect(org.erp).toBeUndefined();

    const erp = attachErp(org, { firstPeriod: "2026-01" });
    expect(org.erp).toBe(erp);
  });
});
