/**
 * Flow state across a restart.
 *
 * The whole reason flows are command-sourced rather than held in memory is
 * that a serverless host cold starts constantly. These tests drive a runtime,
 * throw it away, open a second one over the same log, and check that the
 * second one knows what the first one did.
 */

import { describe, it, expect } from "vitest";
import { parseINR } from "../src/index.js";
import { PaisaRuntime } from "../src/persistence/runtime.js";
import { MemoryActionStore } from "../src/persistence/store.js";
import { sweepFlows } from "../src/erp/flow-sweep.js";
import type { FlowRun } from "../src/erp/flows.js";

const ACTOR = "flow-runner";
const OPTS = { orgId: "org_fp", name: "Nimbus Labs", firstPeriod: "2026-01" };

/** Cash, and a prepaid spread ₹1,00,000 a month from January to June. */
const seed = async (rt: PaisaRuntime) => {
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

  await rt.execute(
    "schedule.addPrepaid",
    {
      input: {
        description: "Annual software licences",
        total: parseINR("6,00,000"),
        startPeriod: "2026-01",
        endPeriod: "2026-06",
        expenseAccountId: "acc_software",
        fundingAccountId: "acc_bank",
        inceptionDate: "2026-01-01",
      },
    },
    ACTOR,
  );
};

const sweep = (rt: PaisaRuntime, asOf: string) =>
  sweepFlows(rt, rt.erp.flows.all(), rt.erp.flows, asOf, ACTOR);

describe("flow state survives a restart", () => {
  it("remembers that a flow was switched on", async () => {
    const store = new MemoryActionStore();

    const first = await PaisaRuntime.open({ ...OPTS, store });
    await first.execute("flows.enable", { flowId: "flow_cfo_digest", enabled: true }, ACTOR);
    expect(first.erp.flows.get("flow_cfo_digest").enabled).toBe(true);

    const restored = await PaisaRuntime.open({ ...OPTS, store });
    expect(restored.erp.flows.get("flow_cfo_digest").enabled).toBe(true);
  });

  it("remembers what already ran, so a cold start does not re-run the month", async () => {
    const store = new MemoryActionStore();

    const first = await PaisaRuntime.open({ ...OPTS, store });
    await seed(first);
    await first.execute("flows.enable", { flowId: "flow_prepaid_amortisation", enabled: true }, ACTOR);
    const before = await sweep(first, "2026-03-01");
    expect(before.runs.filter((r) => r.status === "ok").length).toBe(3);

    // A fresh process over the same log.
    const restored = await PaisaRuntime.open({ ...OPTS, store });
    expect(restored.erp.flows.list("flow_prepaid_amortisation")).toHaveLength(3);

    // Nothing is owed any more, so a sweep at the same date does nothing.
    const again = await sweep(restored, "2026-03-01");
    expect(again.runs).toEqual([]);
  });

  it("rebuilds the ledger the flow posted, not just the record that it ran", async () => {
    const store = new MemoryActionStore();

    const first = await PaisaRuntime.open({ ...OPTS, store });
    await seed(first);
    await first.execute("flows.enable", { flowId: "flow_prepaid_amortisation", enabled: true }, ACTOR);
    await sweep(first, "2026-03-01");
    const posted = first.org.ledger.balance("acc_software", "2026-03-31");
    expect(posted).toBe(parseINR("3,00,000"));

    // Replay re-executes the handler through the same engine path, so the
    // entries are rebuilt rather than restored from a summary.
    const restored = await PaisaRuntime.open({ ...OPTS, store });
    expect(restored.org.ledger.balance("acc_software", "2026-03-31")).toBe(posted);
  });

  it("keeps a rescheduled start date", async () => {
    const store = new MemoryActionStore();

    const first = await PaisaRuntime.open({ ...OPTS, store });
    await first.execute("flows.reschedule", { flowId: "flow_cfo_digest", startDate: "2026-06-01" }, ACTOR);

    const restored = await PaisaRuntime.open({ ...OPTS, store });
    expect(restored.erp.flows.get("flow_cfo_digest").startDate).toBe("2026-06-01");
  });
});

describe("the sweep", () => {
  it("runs nothing for a flow nobody switched on", async () => {
    const rt = await PaisaRuntime.open({ ...OPTS, store: new MemoryActionStore() });
    await seed(rt);
    const result = await sweep(rt, "2026-06-01");
    expect(result.runs).toEqual([]);
    expect(result.errors).toEqual([]);
  });

  it("posts catch-up occurrences oldest first, so replay rebuilds the same sequence", async () => {
    const rt = await PaisaRuntime.open({ ...OPTS, store: new MemoryActionStore() });
    await seed(rt);
    await rt.execute("flows.enable", { flowId: "flow_prepaid_amortisation", enabled: true }, ACTOR);

    const { runs } = await sweep(rt, "2026-04-01");
    expect(runs.map((r: FlowRun) => r.occurrenceKey)).toEqual(["2026-01", "2026-02", "2026-03", "2026-04"]);
  });

  it("records a skipped occurrence rather than leaving a gap", async () => {
    const rt = await PaisaRuntime.open({ ...OPTS, store: new MemoryActionStore() });
    await seed(rt);
    await rt.execute("flows.enable", { flowId: "flow_cfo_digest", enabled: true }, ACTOR);
    await rt.execute("flows.reschedule", { flowId: "flow_cfo_digest", startDate: "2026-01-01" }, ACTOR);

    const { runs } = await sweep(rt, "2026-02-01");
    expect(runs.filter((r) => r.status === "skipped").length).toBeGreaterThan(0);
    expect(runs.filter((r) => r.status === "ok")).toHaveLength(1);
  });

  it("reports what is due and when it next fires", async () => {
    const rt = await PaisaRuntime.open({ ...OPTS, store: new MemoryActionStore() });
    await seed(rt);
    await rt.execute("flows.enable", { flowId: "flow_prepaid_amortisation", enabled: true }, ACTOR);

    const status = rt.erp.flows.status("2026-03-01").find((s) => s.flow.id === "flow_prepaid_amortisation")!;
    expect(status.dueNow).toBe(3);
    expect(status.nextDue).toBe("2026-04-01");
  });
});

describe("replay determinism", () => {
  it("refuses an occurrence for a flow that does not exist", async () => {
    const rt = await PaisaRuntime.open({ ...OPTS, store: new MemoryActionStore() });
    await expect(
      rt.execute(
        "flows.run",
        { flowId: "flow_imaginary", occurrenceKey: "2026-01", scheduledFor: "2026-01-01", period: "2026-01" },
        ACTOR,
      ),
    ).rejects.toThrow(/Unknown flow/);
  });

  it("names the occurrence in the payload rather than deriving it from a clock", async () => {
    const store = new MemoryActionStore();
    const rt = await PaisaRuntime.open({ ...OPTS, store });
    await seed(rt);
    await rt.execute("flows.enable", { flowId: "flow_prepaid_amortisation", enabled: true }, ACTOR);
    await sweep(rt, "2026-02-01");

    // Every logged flow run carries its own occurrence, which is what lets a
    // replay a year from now rebuild exactly these runs and no others.
    const logged = (await store.after(OPTS.orgId, 0)).filter((a) => a.action.type === "flows.run");
    expect(logged.length).toBeGreaterThan(0);
    for (const a of logged) {
      expect(a.action.payload).toHaveProperty("occurrenceKey");
      expect(a.action.payload).toHaveProperty("scheduledFor");
      expect(a.action.payload).toHaveProperty("period");
    }
  });
});
