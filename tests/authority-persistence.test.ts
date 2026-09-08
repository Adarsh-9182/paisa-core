/**
 * Standing authority across a restart.
 *
 * A grant is a permission, and that makes replay a safety property rather
 * than a convenience. Held only in memory, a revocation would vanish on the
 * next cold start and the authority would quietly come back — a permission
 * system whose *revocations* are the part that does not persist is worse
 * than one that never existed, because someone has been told it is off.
 *
 * These drive a runtime, throw it away, open a second one over the same log,
 * and check the second one knows what the first one decided.
 */

import { describe, it, expect } from "vitest";
import { parseINR } from "../src/index.js";
import { PaisaRuntime } from "../src/persistence/runtime.js";
import { MemoryActionStore } from "../src/persistence/store.js";

const ACTOR = "priya";
const OPTS = { orgId: "org_auth_p", name: "Nimbus Labs", firstPeriod: "2026-01" };

const GRANT = {
  id: "auth_accrual",
  kind: "MISSING_ACCRUAL",
  maxAmount: parseINR("50,000"),
  maxPerSweep: parseINR("2,00,000"),
  note: "A recurring vendor's monthly accrual reverses next month.",
};

/** Three months of the same vendor bill, then a month with none. */
const seedAMissedBill = async (rt: PaisaRuntime) => {
  await rt.execute(
    "journal.post",
    {
      date: "2026-01-01",
      narration: "Founder capital",
      lines: [
        { accountId: "acc_bank", side: "DEBIT", amount: parseINR("50,00,000") },
        { accountId: "acc_capital", side: "CREDIT", amount: parseINR("50,00,000") },
      ],
      sourceModule: "manual",
    },
    ACTOR,
  );

  for (const month of ["01", "02", "03"]) {
    const { result: bill } = (await rt.execute(
      "bill.create",
      {
        input: {
          number: `AWS-${month}`,
          vendor: "AWS India",
          billDate: `2026-${month}-05`,
          dueDate: `2026-${month}-25`,
          lines: [
            {
              description: "Hosting",
              amount: parseINR("20,000"),
              expenseAccountId: "acc_software",
              gstRatePct: 18,
              itcEligible: true,
            },
          ],
        },
      },
      ACTOR,
    )) as { result: { id: string } };
    await rt.execute("bill.submit", { billId: bill.id }, ACTOR);
    // Segregation of duties: the person who raised it cannot approve it.
    await rt.execute("bill.approve", { billId: bill.id }, "raj");
  }
};

describe("a grant survives a restart", () => {
  it("remembers the grant, its bounds, and who gave it", async () => {
    const store = new MemoryActionStore();

    const first = await PaisaRuntime.open({ ...OPTS, store });
    await first.execute("authority.grant", GRANT, ACTOR);
    expect(first.erp.authority.get("auth_accrual")!.grantedBy).toBe(ACTOR);

    const restored = await PaisaRuntime.open({ ...OPTS, store });
    const back = restored.erp.authority.get("auth_accrual");
    expect(back).toBeDefined();
    expect(back!.grantedBy).toBe(ACTOR);
    expect(back!.maxAmount).toBe(parseINR("50,000"));
    expect(back!.note).toBe(GRANT.note);
  });

  /**
   * The important one. Everything else here is convenience; this is the
   * difference between "revoked" and "revoked until the next deploy".
   */
  it("stays revoked, and does not quietly come back on a cold start", async () => {
    const store = new MemoryActionStore();

    const first = await PaisaRuntime.open({ ...OPTS, store });
    await first.execute("authority.grant", GRANT, ACTOR);
    await first.execute("authority.revoke", { id: "auth_accrual" }, ACTOR);
    expect(first.erp.authority.get("auth_accrual")!.revokedAt).not.toBeNull();

    const restored = await PaisaRuntime.open({ ...OPTS, store });
    expect(restored.erp.authority.get("auth_accrual")!.revokedAt).not.toBeNull();
    expect(restored.erp.authority.stats().active).toBe(0);

    // And a revoked grant settles nothing after the restart either.
    await seedAMissedBill(restored);
    await restored.execute("agents.scan", { period: "2026-04" }, ACTOR);
    const open = restored.erp.agents.open();
    // Without this the assertions below pass over an empty queue and prove
    // nothing about the revocation at all.
    expect(open.length, "the scenario must leave something settleable").toBeGreaterThan(0);
    const before = restored.org.journal.all().length;

    const { result: settled } = (await restored.execute(
      "authority.settle",
      { proposalIds: open.map((p) => p.id) },
      ACTOR,
    )) as { result: { approved: unknown[] } };

    expect(settled.approved).toHaveLength(0);
    expect(restored.org.journal.all().length).toBe(before);
  });

  it("replays a settlement without posting the same accrual twice", async () => {
    const store = new MemoryActionStore();

    const first = await PaisaRuntime.open({ ...OPTS, store });
    await seedAMissedBill(first);
    await first.execute("authority.grant", GRANT, ACTOR);
    await first.execute("agents.scan", { period: "2026-04" }, ACTOR);

    const open = first.erp.agents.open();
    const { result: settled } = (await first.execute(
      "authority.settle",
      { proposalIds: open.map((p) => p.id) },
      ACTOR,
    )) as { result: { approved: { entryId: string | null }[] } };

    const posted = settled.approved.filter((a) => a.entryId).length;
    expect(posted, "the scenario must actually settle something, or this proves nothing").toBeGreaterThan(0);
    const entriesAfterFirstRun = first.org.journal.all().length;

    // Replay the whole log into a fresh runtime. The settlement is one
    // command naming its proposals, so it rebuilds the same postings — not
    // a second set on top of them.
    const restored = await PaisaRuntime.open({ ...OPTS, store });
    expect(restored.org.journal.all().length).toBe(entriesAfterFirstRun);
    expect(restored.erp.authority.stats().approved).toBe(posted);
  });
});
