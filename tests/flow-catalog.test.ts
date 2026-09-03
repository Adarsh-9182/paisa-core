/**
 * The standard flow catalogue.
 *
 * These assertions are about policy, not plumbing: a posting flow with the
 * wrong catch-up policy leaves the books wrong in a way that reconciles to
 * nothing, and it is silent until someone reads a year of entries by hand.
 */

import { describe, it, expect } from "vitest";
import { STANDARD_FLOWS, POSTING_FLOWS, FLOW_TASKS, flowById } from "../src/erp/flow-catalog.js";
import { planRuns, inMemoryFlowStore, nextOccurrence } from "../src/erp/flows.js";

describe("catalogue", () => {
  it("has a unique id per flow", () => {
    const ids = STANDARD_FLOWS.map((f) => f.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("points every flow at a task name that exists in the registry contract", () => {
    const known = new Set<string>(Object.values(FLOW_TASKS));
    for (const f of STANDARD_FLOWS) expect(known, f.id).toContain(f.task);
  });

  it("ships every flow switched off, so nothing runs that nobody chose", () => {
    for (const f of STANDARD_FLOWS) expect(f.enabled, f.id).toBe(false);
  });

  it("covers the flows a finance team actually schedules", () => {
    expect(STANDARD_FLOWS.map((f) => f.id)).toEqual(
      expect.arrayContaining([
        "flow_prepaid_amortisation",
        "flow_deferred_revenue",
        "flow_pre_close_scan",
        "flow_ar_reminders",
        "flow_cash_forecast",
        "flow_cfo_digest",
        "flow_board_summary",
        "flow_bad_debt",
        "flow_control_monitor",
        "flow_vendor_bill_alert",
      ]),
    );
  });

  it("finds a flow by id", () => {
    expect(flowById("flow_cash_forecast")?.name).toBe("13-week cash forecast");
    expect(flowById("nope")).toBeUndefined();
  });
});

describe("catch-up policy", () => {
  it("catches every period up on flows that post — a skipped month is a wrong book", () => {
    for (const id of POSTING_FLOWS) {
      expect(flowById(id)?.catchUp, id).toBe("each");
    }
  });

  it("never catches up a flow that only reports, so no one is sent stale numbers", () => {
    for (const f of STANDARD_FLOWS) {
      if (POSTING_FLOWS.has(f.id)) continue;
      expect(f.catchUp, f.id).toBe("latest");
    }
  });

  it("posts every missed month after four months of downtime", () => {
    const prepaid = flowById("flow_prepaid_amortisation")!;
    const plan = planRuns(
      { ...prepaid, enabled: true, startDate: "2026-05-01" },
      inMemoryFlowStore(),
      "2026-08-31",
    );
    expect(plan.filter((p) => p.action === "run").map((p) => p.occurrence.key)).toEqual([
      "2026-05",
      "2026-06",
      "2026-07",
      "2026-08",
    ]);
  });

  it("sends one digest after the same downtime, not four", () => {
    const digest = flowById("flow_cfo_digest")!;
    const plan = planRuns(
      { ...digest, enabled: true, startDate: "2026-05-01" },
      inMemoryFlowStore(),
      "2026-08-31",
    );
    expect(plan.filter((p) => p.action === "run")).toHaveLength(1);
    expect(plan.filter((p) => p.action === "skip").length).toBeGreaterThan(0);
  });
});

describe("cadences fire when they claim to", () => {
  it("runs the weekly flows on their stated weekday", () => {
    for (const id of ["flow_ar_reminders", "flow_cash_forecast", "flow_cfo_digest"]) {
      const f = flowById(id)!;
      expect(f.cadence.kind).toBe("weekly");
      const next = nextOccurrence(f.cadence, "2026-09-03")!;
      const weekday = (f.cadence as { weekday: number }).weekday;
      expect(new Date(`${next}T00:00:00Z`).getUTCDay(), id).toBe(weekday);
    }
  });

  it("runs the quarterly flows at the top of a quarter", () => {
    for (const id of ["flow_board_summary", "flow_bad_debt"]) {
      const next = nextOccurrence(flowById(id)!.cadence, "2026-09-03")!;
      expect(next, id).toBe("2026-10-01");
    }
  });

  it("gives the monthly flows twelve firings a year", () => {
    for (const id of ["flow_prepaid_amortisation", "flow_deferred_revenue", "flow_pre_close_scan"]) {
      const f = { ...flowById(id)!, enabled: true, startDate: "2026-01-01" };
      const plan = planRuns(f, inMemoryFlowStore(), "2026-12-31");
      expect(plan, id).toHaveLength(12);
    }
  });
});
