/**
 * Flows — cadence arithmetic, catch-up policy, and the sweep.
 *
 * The scheduling half is pure, so every awkward calendar case is asserted
 * directly: short months, leap days, quarter boundaries, a cadence edited
 * mid-month. The sweep uses stub handlers, so failure isolation and
 * idempotency are covered without a ledger.
 */

import { describe, it, expect, vi } from "vitest";
import {
  occurrencesBetween,
  occurrenceKey,
  planRuns,
  runDue,
  nextOccurrence,
  flowStatus,
  inMemoryFlowStore,
  FlowError,
  MAX_LOOKBACK_DAYS,
  type Cadence,
  type FlowDefinition,
  type FlowHandler,
} from "../src/erp/flows.js";

const daily: Cadence = { kind: "daily" };
const monthly1: Cadence = { kind: "monthly", day: 1 };
const monthly31: Cadence = { kind: "monthly", day: 31 };
const weeklyMon: Cadence = { kind: "weekly", weekday: 1 };
const quarterly: Cadence = { kind: "quarterly", day: 1 };

const flow = (over: Partial<FlowDefinition> = {}): FlowDefinition => ({
  id: "f_1",
  name: "Test flow",
  cadence: monthly1,
  catchUp: "each",
  task: "noop",
  startDate: "2026-01-01",
  enabled: true,
  ...over,
});

const dates = (occ: readonly { scheduledFor: string }[]) => occ.map((o) => o.scheduledFor);
const keys = (occ: readonly { key: string }[]) => occ.map((o) => o.key);

describe("occurrencesBetween", () => {
  it("fires every day for a daily cadence", () => {
    expect(dates(occurrencesBetween(daily, "2026-09-01", "2026-09-04"))).toEqual([
      "2026-09-02",
      "2026-09-03",
      "2026-09-04",
    ]);
  });

  it("treats `after` as exclusive and `asOf` as inclusive", () => {
    const out = dates(occurrencesBetween(daily, "2026-09-01", "2026-09-02"));
    expect(out).toEqual(["2026-09-02"]);
  });

  it("fires on the configured weekday only", () => {
    // 2026-09-07 is a Monday.
    const out = dates(occurrencesBetween(weeklyMon, "2026-09-01", "2026-09-21"));
    expect(out).toEqual(["2026-09-07", "2026-09-14", "2026-09-21"]);
    for (const d of out) expect(new Date(`${d}T00:00:00Z`).getUTCDay()).toBe(1);
  });

  it("fires once a month on the 1st", () => {
    expect(dates(occurrencesBetween(monthly1, "2026-01-15", "2026-04-30"))).toEqual([
      "2026-02-01",
      "2026-03-01",
      "2026-04-01",
    ]);
  });

  it("clamps the 31st to the last day of a short month rather than skipping it", () => {
    // February and April have no 31st. A monthly flow still owes those months
    // an entry, so it fires on the 28th and the 30th.
    const out = dates(occurrencesBetween(monthly31, "2026-01-01", "2026-04-30"));
    expect(out).toEqual(["2026-01-31", "2026-02-28", "2026-03-31", "2026-04-30"]);
  });

  it("clamps to the 29th in a leap February", () => {
    // 2028 is a leap year.
    const out = dates(occurrencesBetween(monthly31, "2028-02-01", "2028-02-29"));
    expect(out).toEqual(["2028-02-29"]);
  });

  it("produces exactly twelve occurrences a year, whatever the day", () => {
    for (const day of [1, 15, 28, 29, 30, 31]) {
      const out = occurrencesBetween({ kind: "monthly", day }, "2025-12-31", "2026-12-31");
      expect(out, `day ${day}`).toHaveLength(12);
    }
  });

  it("fires quarterly in Jan, Apr, Jul and Oct", () => {
    expect(dates(occurrencesBetween(quarterly, "2025-12-31", "2026-12-31"))).toEqual([
      "2026-01-01",
      "2026-04-01",
      "2026-07-01",
      "2026-10-01",
    ]);
  });

  it("never returns two occurrences with the same key", () => {
    const out = occurrencesBetween(monthly31, "2025-12-31", "2026-12-31");
    expect(new Set(keys(out)).size).toBe(out.length);
  });

  it("bounds how far back one sweep looks, so a stale startDate cannot stall it", () => {
    const out = occurrencesBetween(daily, "2020-01-01", "2026-09-03");
    expect(out.length).toBeLessThanOrEqual(MAX_LOOKBACK_DAYS + 1);
  });

  it("returns nothing when the window is empty", () => {
    expect(occurrencesBetween(daily, "2026-09-03", "2026-09-03")).toEqual([]);
  });

  it("rejects a malformed date rather than scheduling against NaN", () => {
    expect(() => occurrencesBetween(daily, undefined, "03-09-2026")).toThrow(FlowError);
    expect(() => occurrencesBetween(daily, "not-a-date", "2026-09-03")).toThrow(FlowError);
  });

  it("rejects a cadence that could never fire", () => {
    expect(() => occurrencesBetween({ kind: "weekly", weekday: 7 }, undefined, "2026-09-03")).toThrow(/weekday/);
    expect(() => occurrencesBetween({ kind: "monthly", day: 0 }, undefined, "2026-09-03")).toThrow(/day/);
    expect(() => occurrencesBetween({ kind: "monthly", day: 32 }, undefined, "2026-09-03")).toThrow(/day/);
  });
});

describe("occurrenceKey", () => {
  it("keys monthly by period, so moving the firing day does not re-run the month", () => {
    expect(occurrenceKey(monthly1, "2026-09-01")).toBe("2026-09");
    expect(occurrenceKey({ kind: "monthly", day: 5 }, "2026-09-05")).toBe("2026-09");
  });

  it("keys quarterly by quarter", () => {
    expect(occurrenceKey(quarterly, "2026-01-01")).toBe("2026-Q1");
    expect(occurrenceKey(quarterly, "2026-07-01")).toBe("2026-Q3");
    expect(occurrenceKey(quarterly, "2026-10-01")).toBe("2026-Q4");
  });

  it("keys daily and weekly by date, which is already unique", () => {
    expect(occurrenceKey(daily, "2026-09-03")).toBe("2026-09-03");
    expect(occurrenceKey(weeklyMon, "2026-09-07")).toBe("2026-09-07");
  });
});

describe("planRuns — catch-up", () => {
  it("runs every missed month when each period is owed an entry", () => {
    // Prepaid amortisation: May through August each need their own posting.
    const store = inMemoryFlowStore();
    const plan = planRuns(flow({ catchUp: "each", startDate: "2026-05-01" }), store, "2026-08-31");
    expect(plan.filter((p) => p.action === "run").map((p) => p.occurrence.key)).toEqual([
      "2026-05",
      "2026-06",
      "2026-07",
      "2026-08",
    ]);
  });

  it("runs only the latest when stale occurrences are worthless", () => {
    // A weekly digest: nobody wants four back-dated ones.
    const store = inMemoryFlowStore();
    const plan = planRuns(flow({ catchUp: "latest", startDate: "2026-05-01" }), store, "2026-08-31");
    const run = plan.filter((p) => p.action === "run");
    expect(run).toHaveLength(1);
    expect(run[0]!.occurrence.key).toBe("2026-08");
  });

  it("records the superseded occurrences rather than leaving an unexplained gap", () => {
    const store = inMemoryFlowStore();
    const plan = planRuns(flow({ catchUp: "latest", startDate: "2026-05-01" }), store, "2026-08-31");
    const skipped = plan.filter((p) => p.action === "skip");
    expect(skipped.map((p) => p.occurrence.key)).toEqual(["2026-05", "2026-06", "2026-07"]);
    expect(skipped[0]!.reason).toContain("superseded by 2026-08");
  });

  it("plans nothing for a disabled flow", () => {
    expect(planRuns(flow({ enabled: false }), inMemoryFlowStore(), "2026-08-31")).toEqual([]);
  });

  it("never plans an occurrence before startDate", () => {
    const plan = planRuns(flow({ startDate: "2026-07-01" }), inMemoryFlowStore(), "2026-08-31");
    expect(plan.every((p) => p.occurrence.scheduledFor >= "2026-07-01")).toBe(true);
  });

  it("includes startDate itself when it is an occurrence", () => {
    const plan = planRuns(flow({ startDate: "2026-07-01" }), inMemoryFlowStore(), "2026-07-01");
    expect(plan.map((p) => p.occurrence.key)).toEqual(["2026-07"]);
  });

  it("plans nothing before the flow has started", () => {
    expect(planRuns(flow({ startDate: "2026-10-01" }), inMemoryFlowStore(), "2026-08-31")).toEqual([]);
  });
});

describe("runDue", () => {
  const registry = (h: FlowHandler, task = "noop") => new Map([[task, h]]);
  const ok: FlowHandler = () => ({ summary: "did the thing", proposalIds: ["prop_1"] });

  it("runs a due flow and records what it raised", async () => {
    const store = inMemoryFlowStore();
    const runs = await runDue([flow({ startDate: "2026-09-01" })], registry(ok), store, "2026-09-01");

    expect(runs).toHaveLength(1);
    expect(runs[0]!.status).toBe("ok");
    expect(runs[0]!.summary).toBe("did the thing");
    expect(runs[0]!.proposalIds).toEqual(["prop_1"]);
  });

  it("does not run the same occurrence twice", async () => {
    const store = inMemoryFlowStore();
    const handler = vi.fn(ok);
    const f = [flow({ startDate: "2026-09-01" })];

    await runDue(f, registry(handler), store, "2026-09-01");
    await runDue(f, registry(handler), store, "2026-09-01");

    expect(handler).toHaveBeenCalledTimes(1);
  });

  it("retries a failed occurrence on the next sweep rather than burying it", async () => {
    const store = inMemoryFlowStore();
    let attempt = 0;
    const flaky: FlowHandler = () => {
      attempt++;
      if (attempt === 1) throw new Error("Stripe timed out");
      return { summary: "recovered" };
    };
    const f = [flow({ startDate: "2026-09-01" })];

    const first = await runDue(f, registry(flaky), store, "2026-09-01");
    expect(first[0]!.status).toBe("failed");
    expect(first[0]!.error).toBe("Stripe timed out");

    const second = await runDue(f, registry(flaky), store, "2026-09-01");
    expect(second[0]!.status).toBe("ok");
    expect(second[0]!.summary).toBe("recovered");
  });

  it("lets one broken flow fail without stopping the others", async () => {
    const store = inMemoryFlowStore();
    const reg = new Map<string, FlowHandler>([
      ["boom", () => { throw new Error("bad rule"); }],
      ["fine", () => ({ summary: "fine" })],
    ]);

    const runs = await runDue(
      [
        flow({ id: "f_boom", task: "boom", startDate: "2026-09-01" }),
        flow({ id: "f_fine", task: "fine", startDate: "2026-09-01" }),
      ],
      reg,
      store,
      "2026-09-01",
    );

    expect(runs.find((r) => r.flowId === "f_boom")!.status).toBe("failed");
    expect(runs.find((r) => r.flowId === "f_fine")!.status).toBe("ok");
  });

  it("fails rather than skips an unregistered task, so it retries once deployed", async () => {
    const store = inMemoryFlowStore();
    const f = [flow({ task: "not_deployed_yet", startDate: "2026-09-01" })];

    const first = await runDue(f, new Map(), store, "2026-09-01");
    expect(first[0]!.status).toBe("failed");
    expect(first[0]!.error).toContain("unknown task");

    // Once the handler ships, the occurrence is still owed.
    const second = await runDue(f, registry(ok, "not_deployed_yet"), store, "2026-09-01");
    expect(second[0]!.status).toBe("ok");
  });

  it("records a skipped occurrence as its own run, not as a silent gap", async () => {
    const store = inMemoryFlowStore();
    const runs = await runDue(
      [flow({ catchUp: "latest", startDate: "2026-06-01" })],
      registry(ok),
      store,
      "2026-09-01",
    );

    expect(runs.filter((r) => r.status === "skipped").map((r) => r.occurrenceKey)).toEqual([
      "2026-06",
      "2026-07",
      "2026-08",
    ]);
    expect(runs.filter((r) => r.status === "ok").map((r) => r.occurrenceKey)).toEqual(["2026-09"]);
  });

  it("hands the handler the occurrence and its accounting period", async () => {
    const store = inMemoryFlowStore();
    const seen: string[] = [];
    const capture: FlowHandler = (ctx) => {
      seen.push(`${ctx.occurrence.key}/${ctx.occurrence.period}`);
      return { summary: "ok" };
    };

    await runDue([flow({ startDate: "2026-07-01" })], registry(capture), store, "2026-09-01");
    expect(seen).toEqual(["2026-07/2026-07", "2026-08/2026-08", "2026-09/2026-09"]);
  });

  it("passes a flow's params through untouched", async () => {
    const store = inMemoryFlowStore();
    let got: unknown;
    const capture: FlowHandler = (ctx) => {
      got = ctx.flow.params;
      return { summary: "ok" };
    };

    await runDue(
      [flow({ startDate: "2026-09-01", params: { threshold: 1_000_000, entity: "org_nimbus" } })],
      registry(capture),
      store,
      "2026-09-01",
    );
    expect(got).toEqual({ threshold: 1_000_000, entity: "org_nimbus" });
  });

  it("awaits an async handler", async () => {
    const store = inMemoryFlowStore();
    const slow: FlowHandler = async () => {
      await new Promise((r) => setTimeout(r, 5));
      return { summary: "async done" };
    };
    const runs = await runDue([flow({ startDate: "2026-09-01" })], registry(slow), store, "2026-09-01");
    expect(runs[0]!.summary).toBe("async done");
  });
});

describe("nextOccurrence", () => {
  it("finds the next firing strictly after the given day", () => {
    expect(nextOccurrence(monthly1, "2026-09-01")).toBe("2026-10-01");
    expect(nextOccurrence(daily, "2026-09-03")).toBe("2026-09-04");
    // 2026-09-03 is a Thursday; the next Monday is the 7th.
    expect(nextOccurrence(weeklyMon, "2026-09-03")).toBe("2026-09-07");
  });

  it("crosses a year boundary", () => {
    expect(nextOccurrence(quarterly, "2026-10-01")).toBe("2027-01-01");
  });
});

describe("flowStatus", () => {
  it("reports what is due and when it next fires", async () => {
    const store = inMemoryFlowStore();
    const f = flow({ catchUp: "each", startDate: "2026-07-01" });

    const before = flowStatus(f, store, "2026-09-01");
    expect(before.dueNow).toBe(3);
    expect(before.lastRun).toBeUndefined();
    expect(before.nextDue).toBe("2026-10-01");

    await runDue([f], new Map([["noop", (() => ({ summary: "ok" })) as FlowHandler]]), store, "2026-09-01");

    const after = flowStatus(f, store, "2026-09-01");
    expect(after.dueNow).toBe(0);
    expect(after.lastRun!.occurrenceKey).toBe("2026-09");
  });

  it("gives a disabled flow no next firing", () => {
    const status = flowStatus(flow({ enabled: false }), inMemoryFlowStore(), "2026-09-01");
    expect(status.nextDue).toBeUndefined();
    expect(status.dueNow).toBe(0);
  });
});
