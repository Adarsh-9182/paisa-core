import { describe, it, expect } from "vitest";
import { parseINR, paise, formatINR, ZERO } from "../src/index.js";
import { PaisaRuntime } from "../src/persistence/runtime.js";
import { MemoryActionStore } from "../src/persistence/store.js";
import { encode, decode, toJson, fromJson } from "../src/persistence/serialize.js";
import { CommandError } from "../src/persistence/commands.js";

const ACTOR = "adarsh";
const OPTS = { orgId: "org_p", name: "Nimbus Labs", firstPeriod: "2026-01" };

/** Run a realistic sequence of business events through a runtime. */
const drive = async (rt: PaisaRuntime) => {
  await rt.execute("journal.post", {
    date: "2026-01-01",
    narration: "Founder capital",
    lines: [
      { accountId: "acc_bank", side: "DEBIT", amount: parseINR("50,00,000") },
      { accountId: "acc_capital", side: "CREDIT", amount: parseINR("50,00,000") },
    ],
    sourceModule: "manual",
  }, ACTOR);

  const contract = await rt.execute<{ id: string; billingSchedule: { id: string }[] }>("contract.create", {
    input: {
      number: "C-001",
      customer: "Acme Pvt Ltd",
      signedDate: "2026-01-01",
      transactionPrice: parseINR("24,00,000"),
      obligations: [
        {
          description: "Platform subscription",
          ssp: parseINR("24,00,000"),
          startDate: "2026-01-01",
          endDate: "2026-12-31",
          method: "RATABLE_MONTHLY",
        },
      ],
      billingFrequency: "ANNUAL",
    },
  }, ACTOR);

  await rt.execute("contract.activate", { contractId: contract.result.id }, ACTOR);
  await rt.execute("revrec.bill", {
    contractId: contract.result.id,
    billingEventId: contract.result.billingSchedule[0]!.id,
    gstRatePct: 18,
  }, ACTOR);
  await rt.execute("revrec.recognize", { period: "2026-01" }, ACTOR);
  await rt.execute("revrec.recognize", { period: "2026-02" }, ACTOR);

  const bill = await rt.execute<{ id: string }>("bill.create", {
    input: {
      number: "AWS-01",
      vendor: "AWS India",
      billDate: "2026-01-05",
      dueDate: "2026-01-25",
      lines: [{ description: "Hosting", amount: parseINR("1,20,000"), expenseAccountId: "acc_software", gstRatePct: 18, itcEligible: true }],
    },
  }, ACTOR);
  await rt.execute("bill.submit", { billId: bill.result.id }, ACTOR);
  await rt.execute("bill.approve", { billId: bill.result.id }, "priya");

  await rt.execute("schedule.addPrepaid", {
    input: {
      description: "Insurance",
      total: parseINR("1,20,000"),
      startPeriod: "2026-01",
      endPeriod: "2026-12",
      expenseAccountId: "acc_professional",
      fundingAccountId: "acc_bank",
    },
  }, ACTOR);
  await rt.execute("schedule.runAmortization", { period: "2026-01" }, ACTOR);
  return contract.result.id;
};

/** A fingerprint of everything that should survive a restart. */
const snapshot = (rt: PaisaRuntime, contractId: string) => ({
  trialBalance: rt.org.ledger
    .trialBalance("2026-12-31")
    .rows.map((r) => `${r.account.code}:${r.debit}/${r.credit}`)
    .join("|"),
  balanced: rt.org.ledger.trialBalance("2026-12-31").balanced,
  bank: rt.org.ledger.balance("acc_bank", "2026-12-31").toString(),
  revenue: rt.org.ledger.balance("acc_subscription_revenue", "2026-12-31").toString(),
  deferred: rt.org.ledger.balance("acc_deferred_revenue", "2026-12-31").toString(),
  ap: rt.org.ledger.balance("acc_ap", "2026-12-31").toString(),
  entries: rt.org.journal.all().map((e) => `${e.id}@${e.date}:${e.narration}`).join("|"),
  contract: JSON.stringify({
    recognized: rt.erp.revrec.recognizedToDate(contractId).toString(),
    billed: rt.erp.revrec.billedToDate(contractId).toString(),
    rpo: rt.erp.revrec.remainingPerformanceObligation().toString(),
  }),
  mrr: rt.erp.metrics.mrr("2026-03").toString(),
});

describe("serialization", () => {
  it("round-trips bigints exactly", () => {
    const value = { amount: parseINR("1,23,456.78"), nested: [paise(1n), paise(-500n)], text: "hello" };
    expect(fromJson(toJson(value))).toEqual(value);
  });

  it("does not confuse a tagged bigint with an ordinary string", () => {
    const value = { note: "12345", amount: paise(12345n) };
    const back = fromJson(toJson(value)) as typeof value;
    expect(typeof back.note).toBe("string");
    expect(typeof back.amount).toBe("bigint");
  });

  it("round-trips maps and sets", () => {
    const value = { limits: new Map([["priya", paise(500n)]]), tags: new Set(["a", "b"]) };
    expect(decode(encode(value))).toEqual(value);
  });
});

describe("replay rebuilds identical state", () => {
  it("restores the ledger, the subledgers and the contract exactly", async () => {
    const store = new MemoryActionStore();
    const live = await PaisaRuntime.open({ ...OPTS, store });
    const contractId = await drive(live);
    const before = snapshot(live, contractId);

    // A cold start against the same log — nothing carried over in memory.
    const restored = await PaisaRuntime.open({ ...OPTS, store });
    expect(snapshot(restored, contractId)).toEqual(before);
    expect(restored.appliedThrough()).toBe(live.appliedThrough());
    expect(restored.skippedActions()).toHaveLength(0);
  });

  it("regenerates the same ids, so references still resolve", async () => {
    const store = new MemoryActionStore();
    const live = await PaisaRuntime.open({ ...OPTS, store });
    const contractId = await drive(live);
    const restored = await PaisaRuntime.open({ ...OPTS, store });

    expect(restored.erp.contracts.get(contractId).number).toBe("C-001");
    expect(restored.org.journal.all().map((e) => e.id)).toEqual(live.org.journal.all().map((e) => e.id));
    expect(restored.erp.bills.all().map((b) => b.id)).toEqual(live.erp.bills.all().map((b) => b.id));
  });

  it("keeps the deferred revenue roll-forward tying after a restart", async () => {
    const store = new MemoryActionStore();
    const live = await PaisaRuntime.open({ ...OPTS, store });
    await drive(live);
    const restored = await PaisaRuntime.open({ ...OPTS, store });
    const rf = restored.erp.revrec.rollforward("2026-01", (d) =>
      restored.org.ledger.balance("acc_deferred_revenue", d),
    );
    expect(rf.tiesToLedger).toBe(true);
  });

  it("survives a close and keeps the period locked", async () => {
    const store = new MemoryActionStore();
    const live = await PaisaRuntime.open({ ...OPTS, store });
    await drive(live);
    await live.execute("close.waive", {
      period: "2026-01", taskId: "bank_reconciliations", reason: "statement pending",
    }, "priya");
    await live.execute("close.explain", {
      period: "2026-01", accountId: "acc_subscription_revenue", explanation: "first month of the contract",
    }, "priya");
    await live.execute("close.run", { period: "2026-01" }, "priya");
    await live.execute("close.lock", { period: "2026-01" }, "priya");
    expect(live.erp.periods.status("2026-01")).toBe("CLOSED");

    const restored = await PaisaRuntime.open({ ...OPTS, store });
    expect(restored.erp.periods.status("2026-01")).toBe("CLOSED");
    // And the lock is still real after the restart.
    await expect(
      restored.execute("journal.post", {
        date: "2026-01-15",
        narration: "late entry",
        lines: [
          { accountId: "acc_travel", side: "DEBIT", amount: parseINR("100") },
          { accountId: "acc_bank", side: "CREDIT", amount: parseINR("100") },
        ],
        sourceModule: "manual",
      }, ACTOR),
    ).rejects.toThrow(/closed/);
  });
});

describe("failed commands", () => {
  it("records the attempt and skips it on replay, so state still matches", async () => {
    const store = new MemoryActionStore();
    const live = await PaisaRuntime.open({ ...OPTS, store });
    await drive(live);

    // An unbalanced entry: rejected live, and still in the log as an attempt.
    await expect(
      live.execute("journal.post", {
        date: "2026-03-01",
        narration: "broken entry",
        lines: [
          { accountId: "acc_bank", side: "DEBIT", amount: parseINR("100") },
          { accountId: "acc_sales", side: "CREDIT", amount: parseINR("90") },
        ],
        sourceModule: "manual",
      }, ACTOR),
    ).rejects.toThrow(/Unbalanced/);

    expect(store.all().some((l) => l.action.payload.narration === "broken entry")).toBe(true);

    const restored = await PaisaRuntime.open({ ...OPTS, store });
    expect(restored.skippedActions()).toHaveLength(1);
    expect(restored.skippedActions()[0]!.reason).toMatch(/Unbalanced/);
    expect(restored.org.journal.all().some((e) => e.narration === "broken entry")).toBe(false);
    expect(restored.org.ledger.trialBalance("2026-12-31").balanced).toBe(true);
  });

  it("refuses a command that is not in the registry rather than losing it", async () => {
    const rt = await PaisaRuntime.open({ ...OPTS, store: new MemoryActionStore() });
    await expect(rt.execute("journal.delete", { entryId: "je_1" }, ACTOR)).rejects.toThrow(CommandError);
  });
});

describe("two instances on one log", () => {
  it("converge when the second syncs", async () => {
    const store = new MemoryActionStore();
    const a = await PaisaRuntime.open({ ...OPTS, store });
    const b = await PaisaRuntime.open({ ...OPTS, store });

    await a.execute("journal.post", {
      date: "2026-01-01",
      narration: "Capital from instance A",
      lines: [
        { accountId: "acc_bank", side: "DEBIT", amount: parseINR("10,00,000") },
        { accountId: "acc_capital", side: "CREDIT", amount: parseINR("10,00,000") },
      ],
      sourceModule: "manual",
    }, ACTOR);

    // B has not looked yet.
    expect(b.org.ledger.balance("acc_bank", "2026-12-31")).toBe(ZERO);
    const report = await b.sync();
    expect(report.applied).toBe(1);
    expect(b.org.ledger.balance("acc_bank", "2026-12-31")).toBe(parseINR("10,00,000"));
  });
});
