/**
 * What get_burn_and_runway hands the model when the business is not burning.
 *
 * Printed as a negative burn, the model repeated "net burn was -₹25,200" back
 * to the founder. The tool now names a net inflow for what it is.
 */
import { describe, it, expect } from "vitest";
import { Platform, parseINR, TOOLS } from "../src/index.js";

const post = (org: any, date: string, debit: string, credit: string, amount: string) =>
  org.journal.post({
    date, narration: "t",
    lines: [
      { accountId: debit, side: "DEBIT", amount: parseINR(amount) },
      { accountId: credit, side: "CREDIT", amount: parseINR(amount) },
    ],
    sourceModule: "manual", createdBy: "test",
  });

describe("get_burn_and_runway", () => {
  it("reports a net inflow, not a negative burn, when cash is growing", () => {
    const org = new Platform().createOrganization("org_in", "Growing Co");
    post(org, "2026-01-01", "acc_bank", "acc_capital", "10,00,000");
    for (const d of ["2026-04-15", "2026-05-15", "2026-06-15"]) post(org, d, "acc_bank", "acc_sales", "30,000");

    const out = TOOLS.get_burn_and_runway!(org, { asOf: "2026-07-02" });
    expect(out).toContain("monthly_net_inflow=₹30,000.00");
    expect(out).toContain("cash_is_growing=true");
    expect(out).not.toContain("-₹");
  });

  it("still reports a burn when cash is shrinking", () => {
    const org = new Platform().createOrganization("org_out", "Burning Co");
    post(org, "2026-01-01", "acc_bank", "acc_capital", "10,00,000");
    for (const d of ["2026-04-15", "2026-05-15", "2026-06-15"]) post(org, d, "acc_rent", "acc_bank", "30,000");

    const out = TOOLS.get_burn_and_runway!(org, { asOf: "2026-07-02" });
    expect(out).toContain("monthly_net_burn=₹30,000.00");
    expect(out).not.toContain("monthly_net_inflow");
  });
});
